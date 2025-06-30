# LORA Token Contract

Um projeto de tokenização de ativos reais (RWA) desenvolvido em Solidity.

## Sobre o Projeto

Este é um contrato inteligente para tokenização de ativos do mundo real. O projeto inclui:

- **LoraToken**: Token principal ERC20 com sistema de staking
- **LoraRWA**: Contrato para tokenização de ativos reais
- **LoraNFTOWN**: Sistema de NFTs para representar propriedade

## Como Usar

### Instalação

```bash
git clone https://github.com/RomuloLora/Lora-Token-Contract.git
cd Lora-Token-Contract
npm install
```

### Configuração

Copie o arquivo de exemplo e configure suas variáveis:

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas chaves:
- PRIVATE_KEY
- INFURA_API_KEY
- ETHERSCAN_API_KEY

### Deploy

Para testar localmente:
```bash
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost
```

Para deploy na testnet:
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

### Testes

```bash
npx hardhat test
```

## Funcionalidades

### LoraToken
- Distribuição inicial de 10.5 milhões de tokens
- Sistema de staking com recompensas
- Governança com propostas e votação
- Taxas de transferência configuráveis

### LoraRWA
- Tokenização de ativos reais
- Sistema de compliance KYC/AML
- Distribuição de yield automática
- Controle de acesso por roles

### LoraNFTOWN
- NFTs representando propriedade de ativos
- Sistema de bloqueio de tokens
- Metadados customizáveis

## Estrutura do Projeto

```
contracts/
├── LoraToken.sol      # Token principal
├── LoraRWA.sol        # Tokenização RWA
├── LoraNFTOWN.sol     # Sistema NFT
└── mocks/
    └── MockPriceFeed.sol

scripts/
├── deploy.js          # Script de deploy
├── interact.js        # Interação com contratos
└── verify.js          # Verificação no Etherscan

test/
├── LoraToken.test.js
├── LoraRWA.test.js
└── LoraNFTOWN.test.js
```

## Tecnologias

- Solidity 0.8.19
- Hardhat
- OpenZeppelin Contracts
- Chainlink Oracles

## Licença

MIT License

## Contato

Para dúvidas ou sugestões, abra uma issue no GitHub.

---

**Nota**: Este é um projeto educacional. Sempre teste antes de usar em produção. 