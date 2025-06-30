const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LoraNFTOWN", function () {
    let LoraToken, LoraRWA, LoraNFTOWN, MockPriceFeed;
    let loraToken, loraRWA, loraNFTOWN, mockPriceFeed;
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

        // Deploy LoraNFTOWN
        LoraNFTOWN = await ethers.getContractFactory("LoraNFTOWN");
        loraNFTOWN = await LoraNFTOWN.deploy();
        await loraNFTOWN.initialize(
            owner.address,
            loraRWA.address
        );
    });

    describe("Deployment", function () {
        it("Should set the right admin", async function () {
            expect(await loraNFTOWN.hasRole(await loraNFTOWN.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
        });

        it("Should set correct external contracts", async function () {
            expect(await loraNFTOWN.loraRWA()).to.equal(loraRWA.address);
        });

        it("Should set correct base URI", async function () {
            expect(await loraNFTOWN.baseURI()).to.equal("https://api.lora.finance/nft/");
        });
    });

    describe("NFT Minting", function () {
        it("Should allow minter to mint NFTs", async function () {
            const assetId = 0;
            const amount = ethers.utils.parseEther("1000");
            const name = "Test NFT";
            const symbol = "TNFT";
            const description = "Test NFT Description";
            const imageURI = "https://example.com/image.jpg";
            const externalURI = "https://example.com/nft";

            await loraNFTOWN.mintNFT(
                assetId,
                user1.address,
                amount,
                name,
                symbol,
                description,
                imageURI,
                externalURI
            );

            const metadata = await loraNFTOWN.getNFTMetadata(1); // tokenId starts at 1
            expect(metadata.assetId).to.equal(assetId);
            expect(metadata.name).to.equal(name);
            expect(metadata.symbol).to.equal(symbol);
            expect(metadata.description).to.equal(description);
            expect(metadata.imageURI).to.equal(imageURI);
            expect(metadata.externalURI).to.equal(externalURI);
            expect(metadata.totalSupply).to.equal(amount);
            expect(metadata.circulatingSupply).to.equal(amount);
        });

        it("Should prevent non-minter from minting NFTs", async function () {
            await expect(
                loraNFTOWN.connect(user1).mintNFT(
                    0,
                    user2.address,
                    ethers.utils.parseEther("1000"),
                    "Test NFT",
                    "TNFT",
                    "Description",
                    "https://example.com/image.jpg",
                    "https://example.com/nft"
                )
            ).to.be.revertedWith("AccessControl");
        });

        it("Should increment token ID correctly", async function () {
            await loraNFTOWN.mintNFT(
                0,
                user1.address,
                ethers.utils.parseEther("1000"),
                "NFT 1",
                "NFT1",
                "Description 1",
                "https://example.com/image1.jpg",
                "https://example.com/nft1"
            );

            await loraNFTOWN.mintNFT(
                1,
                user2.address,
                ethers.utils.parseEther("2000"),
                "NFT 2",
                "NFT2",
                "Description 2",
                "https://example.com/image2.jpg",
                "https://example.com/nft2"
            );

            expect(await loraNFTOWN.nextTokenId()).to.equal(3); // 1 and 2 were minted
        });
    });

    describe("NFT Burning", function () {
        beforeEach(async function () {
            // Mint an NFT first
            await loraNFTOWN.mintNFT(
                0,
                user1.address,
                ethers.utils.parseEther("1000"),
                "Test NFT",
                "TNFT",
                "Description",
                "https://example.com/image.jpg",
                "https://example.com/nft"
            );
        });

        it("Should allow minter to burn NFTs", async function () {
            const burnAmount = ethers.utils.parseEther("500");
            const initialSupply = await loraNFTOWN.getTokenTotalSupply(1);

            await loraNFTOWN.burnNFT(1, burnAmount);

            const finalSupply = await loraNFTOWN.getTokenTotalSupply(1);
            expect(finalSupply).to.equal(initialSupply.sub(burnAmount));
        });

        it("Should prevent burning locked tokens", async function () {
            // Lock the token
            await loraNFTOWN.connect(user1).lockNFT(1, 86400); // 1 day

            await expect(
                loraNFTOWN.burnNFT(1, ethers.utils.parseEther("100"))
            ).to.be.revertedWith("Token is locked");
        });

        it("Should prevent burning more than owned", async function () {
            const burnAmount = ethers.utils.parseEther("2000"); // More than owned

            await expect(
                loraNFTOWN.burnNFT(1, burnAmount)
            ).to.be.revertedWith("Insufficient balance");
        });
    });

    describe("NFT Locking", function () {
        beforeEach(async function () {
            // Mint an NFT first
            await loraNFTOWN.mintNFT(
                0,
                user1.address,
                ethers.utils.parseEther("1000"),
                "Test NFT",
                "TNFT",
                "Description",
                "https://example.com/image.jpg",
                "https://example.com/nft"
            );
        });

        it("Should allow users to lock their NFTs", async function () {
            const lockDuration = 86400; // 1 day

            await loraNFTOWN.connect(user1).lockNFT(1, lockDuration);

            expect(await loraNFTOWN.isTokenLocked(1)).to.equal(true);
            
            const metadata = await loraNFTOWN.getNFTMetadata(1);
            expect(metadata.isLocked).to.equal(true);
            expect(metadata.lockOwner).to.equal(user1.address);
        });

        it("Should prevent locking non-existent tokens", async function () {
            await expect(
                loraNFTOWN.connect(user1).lockNFT(999, 86400)
            ).to.be.revertedWith("NFT does not exist");
        });

        it("Should prevent locking tokens you don't own", async function () {
            await expect(
                loraNFTOWN.connect(user2).lockNFT(1, 86400)
            ).to.be.revertedWith("No tokens to lock");
        });

        it("Should allow users to unlock expired locks", async function () {
            const lockDuration = 3600; // 1 hour
            await loraNFTOWN.connect(user1).lockNFT(1, lockDuration);

            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [3600]); // 1 hour
            await ethers.provider.send("evm_mine");

            await loraNFTOWN.connect(user1).unlockNFT(1);

            expect(await loraNFTOWN.isTokenLocked(1)).to.equal(false);
            
            const metadata = await loraNFTOWN.getNFTMetadata(1);
            expect(metadata.isLocked).to.equal(false);
            expect(metadata.lockOwner).to.equal(ethers.constants.AddressZero);
        });

        it("Should prevent unlocking before expiry", async function () {
            const lockDuration = 86400; // 1 day
            await loraNFTOWN.connect(user1).lockNFT(1, lockDuration);

            await expect(
                loraNFTOWN.connect(user1).unlockNFT(1)
            ).to.be.revertedWith("Lock not expired");
        });

        it("Should prevent others from unlocking your tokens", async function () {
            const lockDuration = 3600; // 1 hour
            await loraNFTOWN.connect(user1).lockNFT(1, lockDuration);

            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine");

            await expect(
                loraNFTOWN.connect(user2).unlockNFT(1)
            ).to.be.revertedWith("Not lock owner");
        });

        it("Should allow admin to force unlock", async function () {
            const lockDuration = 86400; // 1 day
            await loraNFTOWN.connect(user1).lockNFT(1, lockDuration);

            await loraNFTOWN.forceUnlockNFT(1);

            expect(await loraNFTOWN.isTokenLocked(1)).to.equal(false);
        });
    });

    describe("Metadata Management", function () {
        beforeEach(async function () {
            // Mint an NFT first
            await loraNFTOWN.mintNFT(
                0,
                user1.address,
                ethers.utils.parseEther("1000"),
                "Test NFT",
                "TNFT",
                "Description",
                "https://example.com/image.jpg",
                "https://example.com/nft"
            );
        });

        it("Should allow minter to update metadata", async function () {
            const newName = "Updated NFT";
            const newSymbol = "UNFT";
            const newDescription = "Updated Description";
            const newImageURI = "https://example.com/updated-image.jpg";
            const newExternalURI = "https://example.com/updated-nft";

            await loraNFTOWN.updateMetadata(
                1,
                newName,
                newSymbol,
                newDescription,
                newImageURI,
                newExternalURI
            );

            const metadata = await loraNFTOWN.getNFTMetadata(1);
            expect(metadata.name).to.equal(newName);
            expect(metadata.symbol).to.equal(newSymbol);
            expect(metadata.description).to.equal(newDescription);
            expect(metadata.imageURI).to.equal(newImageURI);
            expect(metadata.externalURI).to.equal(newExternalURI);
        });

        it("Should allow admin to update base URI", async function () {
            const newBaseURI = "https://new-api.lora.finance/nft/";
            await loraNFTOWN.updateBaseURI(newBaseURI);

            expect(await loraNFTOWN.baseURI()).to.equal(newBaseURI);
        });

        it("Should allow minter to set token URI", async function () {
            const newURI = "https://example.com/custom-uri";
            await loraNFTOWN.setTokenURI(1, newURI);

            expect(await loraNFTOWN.uri(1)).to.equal(newURI);
        });
    });

    describe("Transfer Restrictions", function () {
        beforeEach(async function () {
            // Mint an NFT first
            await loraNFTOWN.mintNFT(
                0,
                user1.address,
                ethers.utils.parseEther("1000"),
                "Test NFT",
                "TNFT",
                "Description",
                "https://example.com/image.jpg",
                "https://example.com/nft"
            );
        });

        it("Should prevent transferring locked tokens", async function () {
            await loraNFTOWN.connect(user1).lockNFT(1, 86400);

            await expect(
                loraNFTOWN.connect(user1).safeTransferFrom(
                    user1.address,
                    user2.address,
                    1,
                    ethers.utils.parseEther("100"),
                    "0x"
                )
            ).to.be.revertedWith("LoraNFTOWN: token is locked");
        });

        it("Should allow transferring unlocked tokens", async function () {
            const transferAmount = ethers.utils.parseEther("100");
            
            await loraNFTOWN.connect(user1).safeTransferFrom(
                user1.address,
                user2.address,
                1,
                transferAmount,
                "0x"
            );

            expect(await loraNFTOWN.balanceOf(user2.address, 1)).to.equal(transferAmount);
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            // Mint an NFT first
            await loraNFTOWN.mintNFT(
                0,
                user1.address,
                ethers.utils.parseEther("1000"),
                "Test NFT",
                "TNFT",
                "Description",
                "https://example.com/image.jpg",
                "https://example.com/nft"
            );
        });

        it("Should return correct token total supply", async function () {
            const totalSupply = await loraNFTOWN.getTokenTotalSupply(1);
            expect(totalSupply).to.equal(ethers.utils.parseEther("1000"));
        });

        it("Should return correct lock status", async function () {
            expect(await loraNFTOWN.isTokenLocked(1)).to.equal(false);

            await loraNFTOWN.connect(user1).lockNFT(1, 86400);
            expect(await loraNFTOWN.isTokenLocked(1)).to.equal(true);
        });

        it("Should return correct lock expiry", async function () {
            const lockDuration = 86400;
            await loraNFTOWN.connect(user1).lockNFT(1, lockDuration);

            const lockExpiry = await loraNFTOWN.getLockExpiry(1, user1.address);
            expect(lockExpiry).to.be.gt(Math.floor(Date.now() / 1000));
        });

        it("Should return correct lock expiry status", async function () {
            const lockDuration = 3600; // 1 hour
            await loraNFTOWN.connect(user1).lockNFT(1, lockDuration);

            expect(await loraNFTOWN.isLockExpired(1, user1.address)).to.equal(false);

            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine");

            expect(await loraNFTOWN.isLockExpired(1, user1.address)).to.equal(true);
        });

        it("Should return user tokens", async function () {
            const userTokens = await loraNFTOWN.getUserTokens(user1.address);
            expect(userTokens.length).to.equal(1);
            expect(userTokens[0]).to.equal(1);
        });
    });

    describe("Access Control", function () {
        it("Should prevent non-admin from updating base URI", async function () {
            await expect(
                loraNFTOWN.connect(user1).updateBaseURI("https://example.com/")
            ).to.be.revertedWith("AccessControl");
        });

        it("Should prevent non-minter from minting", async function () {
            await expect(
                loraNFTOWN.connect(user1).mintNFT(
                    0,
                    user2.address,
                    ethers.utils.parseEther("1000"),
                    "Test NFT",
                    "TNFT",
                    "Description",
                    "https://example.com/image.jpg",
                    "https://example.com/nft"
                )
            ).to.be.revertedWith("AccessControl");
        });

        it("Should prevent non-minter from updating metadata", async function () {
            await expect(
                loraNFTOWN.connect(user1).updateMetadata(
                    1,
                    "New Name",
                    "NNFT",
                    "New Description",
                    "https://example.com/new-image.jpg",
                    "https://example.com/new-nft"
                )
            ).to.be.revertedWith("AccessControl");
        });
    });
}); 