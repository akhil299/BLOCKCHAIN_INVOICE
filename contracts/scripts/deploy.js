/* Deploys TestUSD, InvoiceToken and InvoiceRegistry, wires them, and exports ABIs + addresses.
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network sepolia
 * Env: OPERATOR_ADDRESS (backend wallet that records AI risk tiers; defaults to the deployer)
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network, artifacts } = hre;
  const [deployer] = await ethers.getSigners();
  const operator = process.env.OPERATOR_ADDRESS || deployer.address;
  console.log(`Network: ${network.name}  Deployer: ${deployer.address}`);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(bal)} ETH`);
  if (bal === 0n) throw new Error("Deployer has 0 ETH. On Sepolia, fund it from a free faucet first.");

  const usd = await (await ethers.getContractFactory("TestUSD")).deploy(deployer.address);
  await usd.waitForDeployment();
  const token = await (await ethers.getContractFactory("InvoiceToken")).deploy(deployer.address);
  await token.waitForDeployment();
  const reg = await (await ethers.getContractFactory("InvoiceRegistry")).deploy(
    deployer.address, await usd.getAddress(), await token.getAddress());
  await reg.waitForDeployment();
  await (await token.setRegistry(await reg.getAddress())).wait();

  if (operator.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await reg.grantRole(await reg.OPERATOR_ROLE(), operator)).wait();
    console.log(`Granted OPERATOR_ROLE to ${operator}`);
  }

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployBlock = (await reg.deploymentTransaction().wait()).blockNumber;
  const deployment = {
    network: network.name,
    chainId,
    deployBlock,
    deployer: deployer.address,
    operator,
    contracts: {
      TestUSD: await usd.getAddress(),
      InvoiceToken: await token.getAddress(),
      InvoiceRegistry: await reg.getAddress(),
    },
  };

  // Addresses go to /shared only (the backend serves them to the frontend via /api/chain/config).
  // ABIs are copied to both places.
  const shared = path.join(__dirname, "../../shared");
  const frontend = path.join(__dirname, "../../frontend/src/contracts");
  fs.mkdirSync(path.join(shared, "abi"), { recursive: true });
  fs.mkdirSync(path.join(frontend, "abi"), { recursive: true });
  fs.writeFileSync(path.join(shared, "deployment.json"), JSON.stringify(deployment, null, 2));
  for (const name of ["TestUSD", "InvoiceToken", "InvoiceRegistry"]) {
    const art = await artifacts.readArtifact(name);
    const json = JSON.stringify(art.abi, null, 2);
    fs.writeFileSync(path.join(shared, "abi", `${name}.json`), json);
    fs.writeFileSync(path.join(frontend, "abi", `${name}.json`), json);
  }
  console.log(JSON.stringify(deployment, null, 2));
  console.log("\nWrote shared/deployment.json and ABIs (shared/abi and frontend/src/contracts/abi). Restart the backend to pick up new addresses.");

  if (network.name === "sepolia" && process.env.ETHERSCAN_API_KEY) {
    console.log("Verify on Etherscan (optional):");
    console.log(`npx hardhat verify --network sepolia ${deployment.contracts.TestUSD} ${deployer.address}`);
    console.log(`npx hardhat verify --network sepolia ${deployment.contracts.InvoiceToken} ${deployer.address}`);
    console.log(`npx hardhat verify --network sepolia ${deployment.contracts.InvoiceRegistry} ${deployer.address} ${deployment.contracts.TestUSD} ${deployment.contracts.InvoiceToken}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
