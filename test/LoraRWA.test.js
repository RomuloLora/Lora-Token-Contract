const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LoraRWA", function () {
    let LoraToken, LoraRWA, MockPriceFeed;
    let loraToken, loraRWA, mockPriceFeed;
    let owner, user1, user2, user3, custodian;
    let addrs;

    beforeEach(async function () {
        [owner, user1, user2, user3, custodian, ...addrs] = await ethers.getSigners();

        // Deploy mock price feed
        MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
        mockPriceFeed = await MockPriceFeed.deploy();
        await mockPriceFeed.deployed();

        // Deploy LoraToken
        LoraToken = await ethers.getContractFactory("LoraToken");
        loraToken = await LoraToken.deploy(
            owner.address,
            owner.address,
            owner.address,
            owner.address,
            mockPriceFeed.address
        );
        await loraToken.deployed();

        // Deploy LoraRWA
        LoraRWA = await ethers.getContractFactory("LoraRWA");
        loraRWA = await LoraRWA.deploy();
        await loraRWA.initialize(
            owner.address,
            loraToken.address,
            mockPriceFeed.address
        );
    });

    describe("Deployment", function () {
        it("Should set the right admin", async function () {
            expect(await loraRWA.hasRole(await loraRWA.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
        });

        it("Should set correct external contracts", async function () {
            expect(await loraRWA.loraToken()).to.equal(loraToken.address);
            expect(await loraRWA.priceFeed()).to.equal(mockPriceFeed.address);
        });

        it("Should set correct default configuration", async function () {
            expect(await loraRWA.minHoldPeriod()).to.equal(86400); // 1 day
            expect(await loraRWA.maxTokensPerAddress()).to.equal(ethers.utils.parseEther("1000000")); // 1M tokens
            expect(await loraRWA.complianceUpdatePeriod()).to.equal(31536000); // 365 days
        });
    });

    describe("Asset Management", function () {
        it("Should allow admin to register assets", async function () {
            const assetName = "Test Real Estate";
            const assetType = "Real Estate";
            const location = "New York, NY";
            const value = ethers.utils.parseEther("1000000"); // $1M
            const documentHash = "QmTestHash";
            const registryNumber = "RE123456";

            await loraRWA.registerAsset(
                assetName,
                assetType,
                location,
                value,
                documentHash,
                registryNumber,
                custodian.address
            );

            const asset = await loraRWA.getAsset(0);
            expect(asset.name).to.equal(assetName);
            expect(asset.assetType).to.equal(assetType);
            expect(asset.location).to.equal(location);
            expect(asset.value).to.equal(value);
            expect(asset.documentHash).to.equal(documentHash);
            expect(asset.registryNumber).to.equal(registryNumber);
            expect(asset.custodian).to.equal(custodian.address);
            expect(asset.isActive).to.equal(true);
            expect(asset.isTokenized).to.equal(false);
        });

        it("Should prevent non-admin from registering assets", async function () {
            await expect(
                loraRWA.connect(user1).registerAsset(
                    "Test Asset",
                    "Real Estate",
                    "Location",
                    ethers.utils.parseEther("1000000"),
                    "QmHash",
                    "REG123",
                    custodian.address
                )
            ).to.be.revertedWith("AccessControl");
        });

        it("Should allow admin to tokenize assets", async function () {
            // Register asset first
            await loraRWA.registerAsset(
                "Test Asset",
                "Real Estate",
                "Location",
                ethers.utils.parseEther("1000000"),
                "QmHash",
                "REG123",
                custodian.address
            );

            const totalTokens = ethers.utils.parseEther("1000000"); // 1M tokens
            await loraRWA.tokenizeAsset(0, totalTokens);

            const asset = await loraRWA.getAsset(0);
            expect(asset.isTokenized).to.equal(true);
            expect(asset.totalTokens).to.equal(totalTokens);
            expect(asset.tokenPrice).to.equal(ethers.utils.parseEther("1")); // $1 per token
        });

        it("Should allow appraiser to update asset valuation", async function () {
            // Register and tokenize asset
            await loraRWA.registerAsset(
                "Test Asset",
                "Real Estate",
                "Location",
                ethers.utils.parseEther("1000000"),
                "QmHash",
                "REG123",
                custodian.address
            );
            await loraRWA.tokenizeAsset(0, ethers.utils.parseEther("1000000"));

            const newValue = ethers.utils.parseEther("1200000"); // $1.2M
            await loraRWA.updateAssetValuation(0, newValue);

            const asset = await loraRWA.getAsset(0);
            expect(asset.value).to.equal(newValue);
            expect(asset.tokenPrice).to.equal(ethers.utils.parseEther("1.2")); // $1.2 per token
        });

        it("Should allow admin to update custodian", async function () {
            await loraRWA.registerAsset(
                "Test Asset",
                "Real Estate",
                "Location",
                ethers.utils.parseEther("1000000"),
                "QmHash",
                "REG123",
                custodian.address
            );

            await loraRWA.updateCustodian(0, user1.address);

            const asset = await loraRWA.getAsset(0);
            expect(asset.custodian).to.equal(user1.address);
        });
    });

    describe("Trading Functions", function () {
        beforeEach(async function () {
            // Register and tokenize asset
            await loraRWA.registerAsset(
                "Test Asset",
                "Real Estate",
                "Location",
                ethers.utils.parseEther("1000000"),
                "QmHash",
                "REG123",
                custodian.address
            );
            await loraRWA.tokenizeAsset(0, ethers.utils.parseEther("1000000"));

            // Setup compliance for users
            await loraRWA.updateCompliance(
                user1.address,
                true, // isWhitelisted
                Math.floor(Date.now() / 1000) + 86400, // kycExpiry (1 day from now)
                "QmKYC",
                "US",
                ethers.utils.parseEther("1000000") // maxHolding
            );

            await loraRWA.updateCompliance(
                user2.address,
                true,
                Math.floor(Date.now() / 1000) + 86400,
                "QmKYC2",
                "US",
                ethers.utils.parseEther("1000000")
            );

            // Transfer LORA tokens to users
            await loraToken.transfer(user1.address, ethers.utils.parseEther("10000"));
            await loraToken.transfer(user2.address, ethers.utils.parseEther("10000"));
        });

        it("Should allow whitelisted users to purchase tokens", async function () {
            const purchaseAmount = ethers.utils.parseEther("1000");
            const expectedCost = ethers.utils.parseEther("1000"); // $1 per token

            await loraToken.connect(user1).approve(loraRWA.address, expectedCost);
            await loraRWA.connect(user1).purchaseTokens(0, purchaseAmount);

            expect(await loraRWA.balanceOf(user1.address, 0)).to.equal(purchaseAmount);
            expect(await loraToken.balanceOf(loraRWA.address)).to.equal(expectedCost);
        });

        it("Should prevent non-whitelisted users from purchasing", async function () {
            await loraToken.connect(user3).approve(loraRWA.address, ethers.utils.parseEther("1000"));
            
            await expect(
                loraRWA.connect(user3).purchaseTokens(0, ethers.utils.parseEther("1000"))
            ).to.be.revertedWith("Not whitelisted");
        });

        it("Should prevent blacklisted users from purchasing", async function () {
            await loraRWA.setBlacklisted(user1.address, true);
            
            await expect(
                loraRWA.connect(user1).purchaseTokens(0, ethers.utils.parseEther("1000"))
            ).to.be.revertedWith("Address blacklisted");
        });

        it("Should allow users to sell tokens", async function () {
            // Purchase tokens first
            const purchaseAmount = ethers.utils.parseEther("1000");
            await loraToken.connect(user1).approve(loraRWA.address, ethers.utils.parseEther("1000"));
            await loraRWA.connect(user1).purchaseTokens(0, purchaseAmount);

            // Fast forward time to meet hold period
            await ethers.provider.send("evm_increaseTime", [86400]); // 1 day
            await ethers.provider.send("evm_mine");

            const sellAmount = ethers.utils.parseEther("500");
            const initialBalance = await loraToken.balanceOf(user1.address);
            
            await loraRWA.connect(user1).sellTokens(0, sellAmount);

            const finalBalance = await loraToken.balanceOf(user1.address);
            expect(finalBalance).to.be.gt(initialBalance);
            expect(await loraRWA.balanceOf(user1.address, 0)).to.equal(purchaseAmount.sub(sellAmount));
        });

        it("Should enforce hold period", async function () {
            const purchaseAmount = ethers.utils.parseEther("1000");
            await loraToken.connect(user1).approve(loraRWA.address, ethers.utils.parseEther("1000"));
            await loraRWA.connect(user1).purchaseTokens(0, purchaseAmount);

            await expect(
                loraRWA.connect(user1).sellTokens(0, ethers.utils.parseEther("500"))
            ).to.be.revertedWith("Hold period not met");
        });
    });

    describe("Yield Distribution", function () {
        beforeEach(async function () {
            // Register and tokenize asset
            await loraRWA.registerAsset(
                "Test Asset",
                "Real Estate",
                "Location",
                ethers.utils.parseEther("1000000"),
                "QmHash",
                "REG123",
                custodian.address
            );
            await loraRWA.tokenizeAsset(0, ethers.utils.parseEther("1000000"));

            // Setup compliance and purchase tokens
            await loraRWA.updateCompliance(
                user1.address,
                true,
                Math.floor(Date.now() / 1000) + 86400,
                "QmKYC",
                "US",
                ethers.utils.parseEther("1000000")
            );

            await loraToken.transfer(user1.address, ethers.utils.parseEther("10000"));
            await loraToken.connect(user1).approve(loraRWA.address, ethers.utils.parseEther("1000"));
            await loraRWA.connect(user1).purchaseTokens(0, ethers.utils.parseEther("1000"));
        });

        it("Should allow admin to distribute yield", async function () {
            const yieldAmount = ethers.utils.parseEther("10000"); // $10K yield
            
            await loraRWA.distributeYield(0, yieldAmount);
            
            const yield = await loraRWA.getYield(0, 0);
            expect(yield.amount).to.equal(yieldAmount);
            expect(yield.claimed).to.equal(false);
        });

        it("Should allow users to claim yield", async function () {
            const yieldAmount = ethers.utils.parseEther("10000");
            await loraRWA.distributeYield(0, yieldAmount);

            const initialBalance = await loraToken.balanceOf(user1.address);
            await loraRWA.connect(user1).claimYield(0, 0);
            const finalBalance = await loraToken.balanceOf(user1.address);

            expect(finalBalance).to.be.gt(initialBalance);
        });

        it("Should prevent double claiming", async function () {
            const yieldAmount = ethers.utils.parseEther("10000");
            await loraRWA.distributeYield(0, yieldAmount);

            await loraRWA.connect(user1).claimYield(0, 0);
            
            await expect(
                loraRWA.connect(user1).claimYield(0, 0)
            ).to.be.revertedWith("Already claimed");
        });
    });

    describe("Compliance Functions", function () {
        it("Should allow compliance role to update user compliance", async function () {
            await loraRWA.updateCompliance(
                user1.address,
                true,
                Math.floor(Date.now() / 1000) + 86400,
                "QmKYC",
                "US",
                ethers.utils.parseEther("1000000")
            );

            const compliance = await loraRWA.getCompliance(user1.address);
            expect(compliance.isWhitelisted).to.equal(true);
            expect(compliance.jurisdiction).to.equal("US");
        });

        it("Should allow compliance role to blacklist users", async function () {
            await loraRWA.setBlacklisted(user1.address, true);
            expect(await loraRWA.blacklisted(user1.address)).to.equal(true);
        });

        it("Should prevent non-compliance role from updating compliance", async function () {
            await expect(
                loraRWA.connect(user1).updateCompliance(
                    user2.address,
                    true,
                    Math.floor(Date.now() / 1000) + 86400,
                    "QmKYC",
                    "US",
                    ethers.utils.parseEther("1000000")
                )
            ).to.be.revertedWith("AccessControl");
        });
    });

    describe("Admin Functions", function () {
        it("Should allow admin to update configuration", async function () {
            await loraRWA.updateMinHoldPeriod(172800); // 2 days
            await loraRWA.updateMaxTokensPerAddress(ethers.utils.parseEther("2000000")); // 2M tokens
            await loraRWA.updateComplianceUpdatePeriod(63072000); // 2 years

            expect(await loraRWA.minHoldPeriod()).to.equal(172800);
            expect(await loraRWA.maxTokensPerAddress()).to.equal(ethers.utils.parseEther("2000000"));
            expect(await loraRWA.complianceUpdatePeriod()).to.equal(63072000);
        });

        it("Should allow admin to pause and unpause", async function () {
            await loraRWA.pause();
            expect(await loraRWA.paused()).to.equal(true);

            await loraRWA.unpause();
            expect(await loraRWA.paused()).to.equal(false);
        });
    });

    describe("View Functions", function () {
        it("Should return correct ETH price", async function () {
            const price = await loraRWA.getEthPrice();
            expect(price).to.be.gt(0);
        });

        it("Should return correct asset count", async function () {
            expect(await loraRWA.assetCount()).to.equal(0);

            await loraRWA.registerAsset(
                "Test Asset",
                "Real Estate",
                "Location",
                ethers.utils.parseEther("1000000"),
                "QmHash",
                "REG123",
                custodian.address
            );

            expect(await loraRWA.assetCount()).to.equal(1);
        });
    });
}); 