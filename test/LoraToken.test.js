const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LoraToken", function () {
    let LoraToken, MockPriceFeed;
    let loraToken, mockPriceFeed;
    let owner, user1, user2, user3;
    let addrs;

    beforeEach(async function () {
        [owner, user1, user2, user3, ...addrs] = await ethers.getSigners();

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
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await loraToken.hasRole(await loraToken.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
        });

        it("Should assign the initial supply to the owner", async function () {
            const ownerBalance = await loraToken.balanceOf(owner.address);
            expect(await loraToken.totalSupply()).to.equal(ownerBalance);
        });

        it("Should have correct initial supply", async function () {
            expect(await loraToken.totalSupply()).to.equal(ethers.utils.parseEther("100000000")); // 100M tokens
        });

        it("Should set correct roles", async function () {
            expect(await loraToken.hasRole(await loraToken.GOVERNANCE_ROLE(), owner.address)).to.equal(true);
            expect(await loraToken.hasRole(await loraToken.EMERGENCY_ROLE(), owner.address)).to.equal(true);
            expect(await loraToken.hasRole(await loraToken.FEE_COLLECTOR_ROLE(), owner.address)).to.equal(true);
            expect(await loraToken.hasRole(await loraToken.MINTER_ROLE(), owner.address)).to.equal(true);
        });
    });

    describe("Basic ERC20 Functions", function () {
        it("Should transfer tokens between accounts", async function () {
            const transferAmount = ethers.utils.parseEther("1000");
            await loraToken.transfer(user1.address, transferAmount);
            expect(await loraToken.balanceOf(user1.address)).to.equal(transferAmount);
        });

        it("Should fail if sender doesn't have enough tokens", async function () {
            const initialOwnerBalance = await loraToken.balanceOf(owner.address);
            await expect(
                loraToken.connect(user1).transfer(owner.address, 1)
            ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
            expect(await loraToken.balanceOf(owner.address)).to.equal(initialOwnerBalance);
        });

        it("Should update balances after transfers", async function () {
            const initialOwnerBalance = await loraToken.balanceOf(owner.address);
            const transferAmount = ethers.utils.parseEther("1000");
            
            await loraToken.transfer(user1.address, transferAmount);
            await loraToken.transfer(user2.address, transferAmount);

            expect(await loraToken.balanceOf(owner.address)).to.equal(initialOwnerBalance.sub(transferAmount.mul(2)));
            expect(await loraToken.balanceOf(user1.address)).to.equal(transferAmount);
            expect(await loraToken.balanceOf(user2.address)).to.equal(transferAmount);
        });
    });

    describe("Staking Functions", function () {
        beforeEach(async function () {
            // Transfer some tokens to users for testing
            await loraToken.transfer(user1.address, ethers.utils.parseEther("10000"));
            await loraToken.transfer(user2.address, ethers.utils.parseEther("10000"));
        });

        it("Should allow users to stake tokens", async function () {
            const stakeAmount = ethers.utils.parseEther("1000");
            await loraToken.connect(user1).approve(loraToken.address, stakeAmount);
            await loraToken.connect(user1).stake(stakeAmount);
            
            const stakerInfo = await loraToken.getStakerInfo(user1.address);
            expect(stakerInfo.stakedAmount).to.equal(stakeAmount);
            expect(stakerInfo.isStaking).to.equal(true);
        });

        it("Should fail to stake if user doesn't have enough tokens", async function () {
            const stakeAmount = ethers.utils.parseEther("20000"); // More than user has
            await expect(
                loraToken.connect(user1).stake(stakeAmount)
            ).to.be.revertedWith("Insufficient balance");
        });

        it("Should allow users to unstake tokens", async function () {
            const stakeAmount = ethers.utils.parseEther("1000");
            await loraToken.connect(user1).approve(loraToken.address, stakeAmount);
            await loraToken.connect(user1).stake(stakeAmount);
            
            const unstakeAmount = ethers.utils.parseEther("500");
            await loraToken.connect(user1).unstake(unstakeAmount);
            
            const stakerInfo = await loraToken.getStakerInfo(user1.address);
            expect(stakerInfo.stakedAmount).to.equal(stakeAmount.sub(unstakeAmount));
        });

        it("Should calculate pending rewards correctly", async function () {
            const stakeAmount = ethers.utils.parseEther("1000");
            await loraToken.connect(user1).approve(loraToken.address, stakeAmount);
            await loraToken.connect(user1).stake(stakeAmount);
            
            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [86400]); // 1 day
            await ethers.provider.send("evm_mine");
            
            const pendingRewards = await loraToken.pendingRewards(user1.address);
            expect(pendingRewards).to.be.gt(0);
        });

        it("Should allow users to claim rewards", async function () {
            const stakeAmount = ethers.utils.parseEther("1000");
            await loraToken.connect(user1).approve(loraToken.address, stakeAmount);
            await loraToken.connect(user1).stake(stakeAmount);
            
            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [86400]); // 1 day
            await ethers.provider.send("evm_mine");
            
            const initialBalance = await loraToken.balanceOf(user1.address);
            await loraToken.connect(user1).claimRewards();
            const finalBalance = await loraToken.balanceOf(user1.address);
            
            expect(finalBalance).to.be.gt(initialBalance);
        });
    });

    describe("Governance Functions", function () {
        it("Should allow governance role to create proposals", async function () {
            const description = "Test proposal";
            const duration = 86400; // 1 day
            
            await loraToken.createProposal(description, duration);
            
            const proposal = await loraToken.getProposal(0);
            expect(proposal.description).to.equal(description);
            expect(proposal.proposer).to.equal(owner.address);
        });

        it("Should allow users to vote on proposals", async function () {
            const description = "Test proposal";
            const duration = 86400; // 1 day
            
            await loraToken.createProposal(description, duration);
            
            // Transfer tokens to user for voting power
            await loraToken.transfer(user1.address, ethers.utils.parseEther("1000"));
            
            await loraToken.connect(user1).vote(0, true);
            
            const hasVoted = await loraToken.hasVoted(0, user1.address);
            expect(hasVoted).to.equal(true);
        });

        it("Should prevent double voting", async function () {
            const description = "Test proposal";
            const duration = 86400; // 1 day
            
            await loraToken.createProposal(description, duration);
            await loraToken.transfer(user1.address, ethers.utils.parseEther("1000"));
            
            await loraToken.connect(user1).vote(0, true);
            
            await expect(
                loraToken.connect(user1).vote(0, false)
            ).to.be.revertedWith("Already voted");
        });
    });

    describe("Admin Functions", function () {
        it("Should allow admin to update staking reward rate", async function () {
            const newRate = 10; // 10% APY
            await loraToken.updateStakingRewardRate(newRate);
            
            // Check if the rate was updated (this would require a getter function)
            // For now, we'll just verify the transaction doesn't revert
            expect(await loraToken.stakingRewardRate()).to.equal(newRate);
        });

        it("Should allow admin to update transfer fee", async function () {
            const newFee = 50; // 0.5%
            await loraToken.updateTransferFee(newFee);
            
            expect(await loraToken.transferFee()).to.equal(newFee);
        });

        it("Should allow admin to update staking fee", async function () {
            const newFee = 20; // 0.2%
            await loraToken.updateStakingFee(newFee);
            
            expect(await loraToken.stakingFee()).to.equal(newFee);
        });

        it("Should allow emergency role to blacklist addresses", async function () {
            await loraToken.setBlacklisted(user1.address, true);
            expect(await loraToken.blacklisted(user1.address)).to.equal(true);
        });

        it("Should prevent blacklisted addresses from transferring", async function () {
            await loraToken.transfer(user1.address, ethers.utils.parseEther("1000"));
            await loraToken.setBlacklisted(user1.address, true);
            
            await expect(
                loraToken.connect(user1).transfer(user2.address, ethers.utils.parseEther("100"))
            ).to.be.revertedWith("Sender is blacklisted");
        });

        it("Should allow minter role to mint tokens", async function () {
            const mintAmount = ethers.utils.parseEther("1000");
            const initialSupply = await loraToken.totalSupply();
            
            await loraToken.mint(user1.address, mintAmount);
            
            expect(await loraToken.totalSupply()).to.equal(initialSupply.add(mintAmount));
            expect(await loraToken.balanceOf(user1.address)).to.equal(mintAmount);
        });

        it("Should prevent minting beyond total supply", async function () {
            const maxMintAmount = ethers.utils.parseEther("900000000"); // Close to total supply
            await loraToken.mint(user1.address, maxMintAmount);
            
            const remainingSupply = ethers.utils.parseEther("1000000000").sub(await loraToken.totalSupply());
            await loraToken.mint(user2.address, remainingSupply);
            
            await expect(
                loraToken.mint(user3.address, ethers.utils.parseEther("1"))
            ).to.be.revertedWith("Exceeds total supply");
        });
    });

    describe("Pausable Functions", function () {
        it("Should allow emergency role to pause and unpause", async function () {
            await loraToken.pause();
            expect(await loraToken.paused()).to.equal(true);
            
            await loraToken.unpause();
            expect(await loraToken.paused()).to.equal(false);
        });

        it("Should prevent transfers when paused", async function () {
            await loraToken.pause();
            
            await expect(
                loraToken.transfer(user1.address, ethers.utils.parseEther("1000"))
            ).to.be.revertedWith("Pausable: paused");
        });
    });

    describe("View Functions", function () {
        it("Should return correct ETH price", async function () {
            const price = await loraToken.getEthPrice();
            expect(price).to.be.gt(0);
        });

        it("Should return correct staker info", async function () {
            const stakeAmount = ethers.utils.parseEther("1000");
            await loraToken.transfer(user1.address, stakeAmount);
            await loraToken.connect(user1).approve(loraToken.address, stakeAmount);
            await loraToken.connect(user1).stake(stakeAmount);
            
            const stakerInfo = await loraToken.getStakerInfo(user1.address);
            expect(stakerInfo.stakedAmount).to.equal(stakeAmount);
            expect(stakerInfo.isStaking).to.equal(true);
        });

        it("Should return correct proposal info", async function () {
            const description = "Test proposal";
            const duration = 86400; // 1 day
            
            await loraToken.createProposal(description, duration);
            
            const proposal = await loraToken.getProposal(0);
            expect(proposal.description).to.equal(description);
            expect(proposal.proposer).to.equal(owner.address);
            expect(proposal.executed).to.equal(false);
            expect(proposal.canceled).to.equal(false);
        });
    });

    describe("Access Control", function () {
        it("Should prevent non-admin from updating staking reward rate", async function () {
            await expect(
                loraToken.connect(user1).updateStakingRewardRate(10)
            ).to.be.revertedWith("AccessControl");
        });

        it("Should prevent non-emergency from blacklisting", async function () {
            await expect(
                loraToken.connect(user1).setBlacklisted(user2.address, true)
            ).to.be.revertedWith("AccessControl");
        });

        it("Should prevent non-minter from minting", async function () {
            await expect(
                loraToken.connect(user1).mint(user2.address, ethers.utils.parseEther("1000"))
            ).to.be.revertedWith("AccessControl");
        });
    });
}); 