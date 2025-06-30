const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    const [deployer, user1, user2] = await ethers.getSigners();
    console.log("Interacting with contracts using account:", deployer.address);

    // Load deployment info
    const network = await ethers.provider.getNetwork();
    const deploymentsDir = path.join(__dirname, '../deployments');
    const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);
    
    if (!fs.existsSync(deploymentFile)) {
        console.error(`Deployment file not found: ${deploymentFile}`);
        console.log("Please run deployment first: npx hardhat run scripts/deploy.js --network <network>");
        process.exit(1);
    }

    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
    console.log("Loaded deployment info:", deploymentInfo);

    // Get contract instances
    const LoraToken = await ethers.getContractFactory("LoraToken");
    const LoraRWA = await ethers.getContractFactory("LoraRWA");
    const LoraNFTOWN = await ethers.getContractFactory("LoraNFTOWN");

    const loraToken = LoraToken.attach(deploymentInfo.contracts.loraToken);
    const loraRWA = LoraRWA.attach(deploymentInfo.contracts.loraRWA);
    const loraNFTOWN = LoraNFTOWN.attach(deploymentInfo.contracts.loraNFTOWN);

    console.log("\n=== Contract Interaction Examples ===");

    // Example 1: Check LORA Token Info
    console.log("\n1. LORA Token Information:");
    console.log("Name:", await loraToken.name());
    console.log("Symbol:", await loraToken.symbol());
    console.log("Total Supply:", ethers.utils.formatEther(await loraToken.totalSupply()));
    console.log("Decimals:", await loraToken.decimals());
    console.log("Owner Balance:", ethers.utils.formatEther(await loraToken.balanceOf(deployer.address)));

    // Example 2: Transfer LORA Tokens
    console.log("\n2. Transfer LORA Tokens:");
    const transferAmount = ethers.utils.parseEther("1000");
    const tx1 = await loraToken.transfer(user1.address, transferAmount);
    await tx1.wait();
    console.log(`Transferred ${ethers.utils.formatEther(transferAmount)} LORA to ${user1.address}`);
    console.log("User1 Balance:", ethers.utils.formatEther(await loraToken.balanceOf(user1.address)));

    // Example 3: Staking Example
    console.log("\n3. Staking Example:");
    const stakeAmount = ethers.utils.parseEther("500");
    await loraToken.connect(user1).approve(loraToken.address, stakeAmount);
    const tx2 = await loraToken.connect(user1).stake(stakeAmount);
    await tx2.wait();
    console.log(`User1 staked ${ethers.utils.formatEther(stakeAmount)} LORA tokens`);

    const stakerInfo = await loraToken.getStakerInfo(user1.address);
    console.log("Staked Amount:", ethers.utils.formatEther(stakerInfo.stakedAmount));
    console.log("Is Staking:", stakerInfo.isStaking);

    // Example 4: Register RWA Asset
    console.log("\n4. Register RWA Asset:");
    const assetName = "Downtown Office Building";
    const assetType = "Real Estate";
    const location = "New York, NY";
    const value = ethers.utils.parseEther("5000000"); // $5M
    const documentHash = "QmTestDocumentHash123";
    const registryNumber = "RE2024001";

    const tx3 = await loraRWA.registerAsset(
        assetName,
        assetType,
        location,
        value,
        documentHash,
        registryNumber,
        deployer.address // custodian
    );
    await tx3.wait();
    console.log("Asset registered with ID: 0");

    const asset = await loraRWA.getAsset(0);
    console.log("Asset Name:", asset.name);
    console.log("Asset Value:", ethers.utils.formatEther(asset.value));
    console.log("Asset Type:", asset.assetType);

    // Example 5: Tokenize Asset
    console.log("\n5. Tokenize Asset:");
    const totalTokens = ethers.utils.parseEther("1000000"); // 1M tokens
    const tx4 = await loraRWA.tokenizeAsset(0, totalTokens);
    await tx4.wait();
    console.log(`Asset tokenized with ${ethers.utils.formatEther(totalTokens)} tokens`);

    const tokenizedAsset = await loraRWA.getAsset(0);
    console.log("Token Price:", ethers.utils.formatEther(tokenizedAsset.tokenPrice));
    console.log("Is Tokenized:", tokenizedAsset.isTokenized);

    // Example 6: Setup Compliance and Purchase Tokens
    console.log("\n6. Setup Compliance and Purchase Tokens:");
    
    // Setup compliance for user2
    await loraRWA.updateCompliance(
        user2.address,
        true, // isWhitelisted
        Math.floor(Date.now() / 1000) + 86400, // kycExpiry (1 day from now)
        "QmKYCUser2",
        "US",
        ethers.utils.parseEther("1000000") // maxHolding
    );
    console.log("Compliance set up for User2");

    // Transfer LORA tokens to user2 for purchase
    await loraToken.transfer(user2.address, ethers.utils.parseEther("10000"));
    
    // Purchase RWA tokens
    const purchaseAmount = ethers.utils.parseEther("1000");
    await loraToken.connect(user2).approve(loraRWA.address, ethers.utils.parseEther("1000"));
    const tx5 = await loraRWA.connect(user2).purchaseTokens(0, purchaseAmount);
    await tx5.wait();
    console.log(`User2 purchased ${ethers.utils.formatEther(purchaseAmount)} RWA tokens`);

    const user2Balance = await loraRWA.balanceOf(user2.address, 0);
    console.log("User2 RWA Balance:", ethers.utils.formatEther(user2Balance));

    // Example 7: Mint NFT for RWA Ownership
    console.log("\n7. Mint NFT for RWA Ownership:");
    const nftName = "Downtown Office Building NFT";
    const nftSymbol = "DOBNFT";
    const nftDescription = "NFT representing ownership in Downtown Office Building";
    const nftImageURI = "https://example.com/office-building.jpg";
    const nftExternalURI = "https://example.com/nft/office-building";

    const tx6 = await loraNFTOWN.mintNFT(
        0, // assetId
        user2.address, // owner
        purchaseAmount, // amount
        nftName,
        nftSymbol,
        nftDescription,
        nftImageURI,
        nftExternalURI
    );
    await tx6.wait();
    console.log("NFT minted for User2");

    const nftMetadata = await loraNFTOWN.getNFTMetadata(1); // tokenId starts at 1
    console.log("NFT Name:", nftMetadata.name);
    console.log("NFT Symbol:", nftMetadata.symbol);
    console.log("NFT Total Supply:", ethers.utils.formatEther(nftMetadata.totalSupply));

    // Example 8: Lock NFT
    console.log("\n8. Lock NFT:");
    const lockDuration = 3600; // 1 hour
    const tx7 = await loraNFTOWN.connect(user2).lockNFT(1, lockDuration);
    await tx7.wait();
    console.log(`NFT locked for ${lockDuration} seconds`);

    const isLocked = await loraNFTOWN.isTokenLocked(1);
    console.log("NFT Locked:", isLocked);

    // Example 9: Create Governance Proposal
    console.log("\n9. Create Governance Proposal:");
    const proposalDescription = "Increase staking reward rate to 10% APY";
    const proposalDuration = 86400; // 1 day

    const tx8 = await loraToken.createProposal(proposalDescription, proposalDuration);
    await tx8.wait();
    console.log("Governance proposal created");

    const proposal = await loraToken.getProposal(0);
    console.log("Proposal Description:", proposal.description);
    console.log("Proposal Start Time:", new Date(proposal.startTime * 1000).toISOString());
    console.log("Proposal End Time:", new Date(proposal.endTime * 1000).toISOString());

    // Example 10: Vote on Proposal
    console.log("\n10. Vote on Proposal:");
    const tx9 = await loraToken.connect(user1).vote(0, true); // Vote in favor
    await tx9.wait();
    console.log("User1 voted in favor of the proposal");

    const hasVoted = await loraToken.hasVoted(0, user1.address);
    console.log("User1 has voted:", hasVoted);

    console.log("\n=== Interaction Examples Completed ===");
    console.log("\nContract Addresses:");
    console.log("LORA Token:", loraToken.address);
    console.log("LORA RWA:", loraRWA.address);
    console.log("LORA NFT-OWN:", loraNFTOWN.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 