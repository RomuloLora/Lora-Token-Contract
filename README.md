# Lora-Token-Contract
Contract RWA - LORA
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title LORA Token
 * @dev Token ERC20 premium com recursos avançados de governança, vesting e RWA
 * @author Lora Finance
 * @notice Implementa um token ERC20 com supply máximo, vesting programável e mecanismos de governança
 * @custom:security-contact security@lorafinance.com
 */
contract LoraToken is ERC20, ERC20Burnable, ERC20Permit, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ================ CONSTANTES E ESTADO ================
    
    // Definição de roles para controle de acesso
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant VESTING_MANAGER_ROLE = keccak256("VESTING_MANAGER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    // Constantes e variáveis de estado
    uint256 public immutable MAX_SUPPLY;
    uint256 private _remainingSupply;
    uint256 public lastMintTimestamp;
    uint256 public constant YEAR_PERIOD = 365 days;
    uint256 public constant VESTING_DURATION = 4 * 365 days; // 4 anos
    string private _tokenURI;

    // Anti-manipulação e limites
    uint256 public constant MAX_MINT_AMOUNT_PER_TX = 1_000_000 * (10 ** 18); // 1 milhão de tokens por transação
    uint256 public constant MINT_COOLING_PERIOD = 1 days; // Período mínimo entre mints por cada minter
    uint256 public antiWhaleLimit = 500_000 * (10 ** 18); // Limite anti-whale (500k tokens)
    mapping(address => uint256) public lastMintByMinter;

    // Dados e verificações de RWA
    struct AssetData {
        string assetType;
        string description;
        string documentHash;
        uint256 verificationTimestamp;
        address verifier;
        uint256 assetValue;
        string assetLocation;
        bool active;
    }
    
    mapping(uint256 => AssetData) public backedAssets;
    uint256 public assetCount;
    uint256 public totalAssetValue;
    
    // TimeController para funções críticas
    TimelockController public timelock;
    
    // Feed de preço Chainlink
    AggregatorV3Interface public priceFeed;
    uint256 public lastPriceUpdate;
    uint256 public currentPrice;
    
    // Estrutura para planos de vesting
    struct VestingSchedule {
        uint256 totalAmount;
        uint256 startTime;
        uint256 cliff;
        uint256 duration;
        uint256 released;
        uint256 periods;
        bool active;
        bool revocable;
        bool revoked;
        address beneficiary;
    }
    
    // Mappings
    mapping(address => bool) private _whitelist;
    mapping(address => VestingSchedule) private _vestingSchedules;
    mapping(address => uint256) private _vestingTotalAllocated;
    mapping(address => uint256) public lastTransactionTime;
    mapping(address => bool) public blacklisted;
    
    // Rastreamento de todos os beneficiários de vesting
    address[] public vestingBeneficiaries;
    
    // Controle de aprovação de mint
    struct MintRequest {
        address to;
        uint256 amount;
        bool approved;
        uint256 approvalCount;
        mapping(address => bool) approvers;
    }
    
    uint256 public mintRequestCount;
    mapping(uint256 => MintRequest) public mintRequests;
    uint256 public requiredMintApprovals = 2; // Número mínimo de aprovações para mint
    
    // Registro multisig para operações críticas
    uint256 public requiredOperationApprovals = 2;
    mapping(bytes32 => mapping(address => bool)) public operationApprovals;
    mapping(bytes32 => uint256) public operationApprovalsCount;
    mapping(bytes32 => bool) public operationExecuted;
    
    // Controle de taxas de transferência
    uint256 public transferFeeRate = 0; // 0% inicialmente
    uint256 public constant MAX_FEE_RATE = 300; // Máximo de 3%
    address public feeCollector;
    bool public feesEnabled = false;
    mapping(address => bool) public feeExempt;
    
    // Garantia de liquidez
    uint256 public liquidityRatio = 2000; // 20% do supply deve ser mantido como liquidez
    uint256 public liquidityBalance;
    address public liquidityPool;

    // ================ EVENTOS ================

    event Whitelisted(address indexed account, bool status);
    event Blacklisted(address indexed account, bool status);
    event VestingScheduleCreated(address indexed beneficiary, uint256 amount, uint256 cliff, uint256 duration, uint256 periods, bool revocable);
    event TokensReleased(address indexed beneficiary, uint256 amount);
    event AnnualTokensReleased(address indexed recipient, uint256 amount);
    event MintRequested(uint256 indexed requestId, address indexed requester, address to, uint256 amount);
    event MintApproved(uint256 indexed requestId, address indexed approver);
    event MintExecuted(uint256 indexed requestId, address indexed to, uint256 amount);
    event VestingRevoked(address indexed beneficiary, uint256 unreleasedAmount);
    event EmergencyVestingWithdrawal(address indexed beneficiary, uint256 amount);
    event OperationRequested(bytes32 indexed operationId, address indexed requester);
    event OperationApproved(bytes32 indexed operationId, address indexed approver);
    event OperationExecuted(bytes32 indexed operationId);
    event PriceUpdated(uint256 newPrice, uint256 timestamp);
    event FeeRateUpdated(uint256 oldRate, uint256 newRate);
    event FeeCollected(address indexed from, address indexed to, uint256 amount, uint256 fee);
    event AssetRegistered(uint256 indexed assetId, string assetType, uint256 value, string documentHash);
    event AssetVerified(uint256 indexed assetId, address verifier);
    event AssetDeactivated(uint256 indexed assetId);
    event AntiWhaleLimitUpdated(uint256 newLimit);
    event TokenURIUpdated(string newURI);
    event LiquidityAdded(uint256 amount);
    event LiquidityRemoved(uint256 amount);
    event LiquidityPoolUpdated(address oldPool, address newPool);
    event TimelockControllerUpdated(address newTimelock);
    event FeeExemptStatusUpdated(address indexed account, bool status);
    event ApprovalDebug(address indexed spender, uint256 amount);

    // ================ MODIFICADORES ================

    /**
     * @dev Modifier para requerimento de múltiplas aprovações
     * @param operationId ID da operação
     */
    modifier requireMultipleApprovals(bytes32 operationId) {
        if (!operationApprovals[operationId][msg.sender]) {
            operationApprovals[operationId][msg.sender] = true;
            operationApprovalsCount[operationId] += 1;
            emit OperationApproved(operationId, msg.sender);
        }
        
        require(operationApprovalsCount[operationId] >= requiredOperationApprovals, 
            "LoraToken: precisa de mais aprovacoes");
        
        require(!operationExecuted[operationId], "LoraToken: operacao ja executada");
        operationExecuted[operationId] = true;
        emit OperationExecuted(operationId);
        _;
    }
    
    /**
     * @dev Verifica se o endereço não está na blacklist
     */
    modifier notBlacklisted(address account) {
        require(!blacklisted[account], "LoraToken: endereco na blacklist");
        _;
    }
    
    /**
     * @dev Verifica limite anti-whale para transferências
     */
    modifier antiWhale(address sender, address recipient, uint256 amount) {
        // Exclui transferências para/do contrato e endereços isentos
        if (sender != address(this) && recipient != address(this) && 
            !feeExempt[sender] && !feeExempt[recipient]) {
            require(amount <= antiWhaleLimit, "LoraToken: excede limite anti-whale");
        }
        _;
    }

    /**
     * @dev Verifica se o timelock foi configurado corretamente
     */
    modifier validTimelock() {
        require(address(timelock) != address(0), "LoraToken: timelock nao configurado");
        _;
    }

    // ================ CONSTRUTOR ================

    /**
     * @dev Inicializa o contrato com o owner inicial e o endereço de governança
     * @param initialOwner Endereço do proprietário inicial com todos os privilégios
     * @param governance Endereço com permissões de governança
     * @param emergencyMultisig Endereço do multisig para operações de emergência
     * @param feeCollectorAddress Endereço para coleta de taxas
     * @param priceFeedAddress Endereço do feed de preço Chainlink (opcional)
     */
    constructor(
        address initialOwner, 
        address governance, 
        address emergencyMultisig,
        address feeCollectorAddress,
        address priceFeedAddress
    ) 
        ERC20("LORA Token", "LORA") 
        ERC20Permit("LORA Token")
    {
        require(initialOwner != address(0), "LoraToken: Owner address cannot be zero");        require(governance != address(0), "LoraToken: Governance address cannot be zero");        require(emergencyMultisig != address(0), "LoraToken: Emergency multisig address cannot be zero");        require(feeCollectorAddress != address(0), "LoraToken: Fee collector address cannot be zero");

        // Configuração do supply máximo: 21 milhões de tokens
        MAX_SUPPLY = 21_000_000 * (10 ** decimals());
        _remainingSupply = MAX_SUPPLY;
        lastMintTimestamp = block.timestamp;
        feeCollector = feeCollectorAddress;

        // Configuração das permissões iniciais
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE, initialOwner);
        _grantRole(GOVERNANCE_ROLE, governance);
        _grantRole(VESTING_MANAGER_ROLE, initialOwner);
        _grantRole(EMERGENCY_ROLE, emergencyMultisig);
        _grantRole(ORACLE_ROLE, initialOwner);

        // Inicialização do tokenURI
        _tokenURI = "https://lorafinance.com/token-metadata";
        
        // Inicializa o feed de preço se fornecido
        if (priceFeedAddress != address(0)) {
            priceFeed = AggregatorV3Interface(priceFeedAddress);
            _updatePrice();
        }

        // Inicializa o timelock
        address[] memory proposers = new address[](2);
        proposers[0] = initialOwner;
        proposers[1] = governance;
        address[] memory executors = new address[](2);
        executors[0] = initialOwner;
        executors[1] = governance;
        timelock = new TimelockController(3 days, proposers, executors, initialOwner);

        // Configurações iniciais de whitelist e isenções de taxa
        _whitelist[initialOwner] = true;
        _whitelist[governance] = true;
        _whitelist[emergencyMultisig] = true;
        feeExempt[initialOwner] = true;
        feeExempt[governance] = true;
        feeExempt[emergencyMultisig] = true;
        feeExempt[address(this)] = true;

        // Alocação inicial de 5% para o criador com vesting de 4 anos
        uint256 creatorAllocation = (MAX_SUPPLY * 5) / 100;
        _createVestingSchedule(
            initialOwner, 
            creatorAllocation,
            365 days,  // 1 ano de cliff
            VESTING_DURATION,  // 4 anos de vesting
            4,         // Liberação trimestral
            false      // Não revogável
        );
        _remainingSupply -= creatorAllocation;
    }

    // ================ FUNÇÕES PÚBLICAS ================

    /**
     * @dev Sobrescreve a função de transferência padrão para incluir taxas e verificações
     * @param to Endereço do destinatário
     * @param amount Quantidade de tokens a transferir
     */
    function transfer(address to, uint256 amount) 
        public 
        override 
        nonReentrant 
        whenNotPaused 
        notBlacklisted(msg.sender) 
        notBlacklisted(to)
        antiWhale(msg.sender, to, amount)
        returns (bool) 
    {
        require(to != address(0), "LoraToken: transfer para endereco zero");
        
        uint256 fee = 0;
        if (feesEnabled && !feeExempt[msg.sender]) {
            fee = (amount * transferFeeRate) / 10000;
            require(balanceOf(msg.sender) >= amount + fee, "LoraToken: saldo insuficiente para taxa");
        }
        
        if (fee > 0) {
            super.transfer(feeCollector, fee);
            emit FeeCollected(msg.sender, feeCollector, amount, fee);
        }
        
        super.transfer(to, amount);
        lastTransactionTime[msg.sender] = block.timestamp;
        return true;
    }

    /**
     * @dev Sobrescreve a função de transferFrom para incluir taxas e verificações
     * @param from Endereço do remetente
     * @param to Endereço do destinatário
     * @param amount Quantidade de tokens a transferir
     */
    function transferFrom(address from, address to, uint256 amount) 
        public 
        override 
        nonReentrant 
        whenNotPaused 
        notBlacklisted(from) 
        notBlacklisted(to)
        antiWhale(from, to, amount)
        returns (bool) 
    {
        require(to != address(0), "LoraToken: transfer para endereco zero");
        
        uint256 fee = 0;
        if (feesEnabled && !feeExempt[from]) {
            fee = (amount * transferFeeRate) / 10000;
            require(balanceOf(from) >= amount + fee, "LoraToken: saldo insuficiente para taxa");
        }
        
        if (fee > 0) {
            super.transferFrom(from, feeCollector, fee);
            emit FeeCollected(from, feeCollector, amount, fee);
        }
        
        super.transferFrom(from, to, amount);
        lastTransactionTime[from] = block.timestamp;
        return true;
    }

    // ================ FUNÇÕES DE GOVERNANÇA ================

    /**
     * @dev Adiciona ou remove um endereço da whitelist
     * @param account Endereço para atualizar na whitelist
     * @param status Status a ser definido (true = adicionar, false = remover)
     */
    function updateWhitelist(address account, bool status) external onlyRole(GOVERNANCE_ROLE) {
        require(account != address(0), "LoraToken: endereco zero");
        _whitelist[account] = status;
        emit Whitelisted(account, status);
    }
    
    /**
     * @dev Adiciona ou remove um endereço da blacklist
     * @param account Endereço para atualizar na blacklist
     * @param status Status a ser definido (true = adicionar, false = remover)
     */
    function updateBlacklist(address account, bool status) 
        external 
        requireMultipleApprovals(keccak256(abi.encodePacked("blacklist", account, status))) 
        onlyRole(GOVERNANCE_ROLE) 
    {
        require(account != address(0), "LoraToken: endereco zero");
        blacklisted[account] = status;
        emit Blacklisted(account, status);
    }

    /**
     * @dev Atualiza a taxa de transferência
     * @param newRate Nova taxa em pontos base (ex: 100 = 1%)
     */
    function updateTransferFeeRate(uint256 newRate) 
        external 
        requireMultipleApprovals(keccak256(abi.encodePacked("updateFeeRate", newRate)))
        onlyRole(GOVERNANCE_ROLE)
    {
        require(newRate <= MAX_FEE_RATE, "LoraToken: taxa acima do maximo permitido");
        uint256 oldRate = transferFeeRate;
        transferFeeRate = newRate;
        emit FeeRateUpdated(oldRate, newRate);
    }

    /**
     * @dev Ativa/desativa o sistema de taxas
     * @param enabled Novo status do sistema de taxas
     */
    function setFeesEnabled(bool enabled) 
        external 
        requireMultipleApprovals(keccak256(abi.encodePacked("setFeesEnabled", enabled)))
        onlyRole(GOVERNANCE_ROLE)
    {
        feesEnabled = enabled;
    }

    /**
     * @dev Atualiza o limite anti-whale
     * @param newLimit Novo limite em unidades de token
     */
    function updateAntiWhaleLimit(uint256 newLimit) 
        external 
        requireMultipleApprovals(keccak256(abi.encodePacked("updateAntiWhale", newLimit)))
        onlyRole(GOVERNANCE_ROLE)
    {
        antiWhaleLimit = newLimit;
        emit AntiWhaleLimitUpdated(newLimit);
    }

    /**
     * @dev Atualiza o endereço do coletor de taxas
     * @param newCollector Novo endereço do coletor
     */
    function updateFeeCollector(address newCollector) 
        external 
        requireMultipleApprovals(keccak256(abi.encodePacked("updateFeeCollector", newCollector)))
        onlyRole(GOVERNANCE_ROLE)
    {
        require(newCollector != address(0), "LoraToken: endereco zero");
        feeCollector = newCollector;
    }

    // ================ FUNÇÕES DE VESTING ================

    /**
     * @dev Cria um cronograma de vesting para um beneficiário
     * @param beneficiary Endereço do beneficiário
     * @param amount Quantidade total de tokens para vesting
     * @param cliff Período de cliff antes do início das liberações
     * @param duration Duração total do vesting
     * @param periods Número de períodos para liberação gradual
     * @param revocable Se o vesting pode ser revogado por governança
     */
    function createVestingSchedule(
        address beneficiary,
        uint256 amount,
        uint256 cliff,
        uint256 duration,
        uint256 periods,
        bool revocable
    ) external onlyRole(VESTING_MANAGER_ROLE) {
        require(_remainingSupply >= amount, "LoraToken: supply insuficiente");
        require(beneficiary != address(0), "LoraToken: beneficiario com endereco zero");
        require(amount > 0, "LoraToken: quantidade zero");
        require(periods > 0, "LoraToken: periodos invalidos");
        require(!_vestingSchedules[beneficiary].active, "LoraToken: vesting ja existe");
        require(duration >= cliff, "LoraToken: duracao deve ser maior que cliff");

        _createVestingSchedule(beneficiary, amount, cliff, duration, periods, revocable);
        _remainingSupply -= amount;
    }

    /**
     * @dev Implementação interna para criar cronograma de vesting
     */
    function _createVestingSchedule(
        address beneficiary,
        uint256 amount,
        uint256 cliff,
        uint256 duration,
        uint256 periods,
        bool revocable
    ) private {
        _vestingSchedules[beneficiary] = VestingSchedule({
            totalAmount: amount,
            startTime: block.timestamp,
            cliff: cliff,
            duration: duration,
            released: 0,
            periods: periods,
            active: true,
            revocable: revocable,
            revoked: false,
            beneficiary: beneficiary
        });
        
        _vestingTotalAllocated[beneficiary] = amount;
        vestingBeneficiaries.push(beneficiary);
        
        emit VestingScheduleCreated(beneficiary, amount, cliff, duration, periods, revocable);
    }

    /**
     * @dev Libera tokens disponíveis de um cronograma de vesting
     * @return amount Quantidade de tokens liberados
     */
    function releaseVestedTokens() external nonReentrant whenNotPaused notBlacklisted(msg.sender) returns (uint256 amount) {
        uint256 releasable = _computeReleasableAmount(msg.sender);
        require(releasable > 0, "LoraToken: nada para liberar");

        VestingSchedule storage schedule = _vestingSchedules[msg.sender];
        require(!schedule.revoked, "LoraToken: vesting foi revogado");
        
        schedule.released += releasable;
        
        _mint(msg.sender, releasable);
        emit TokensReleased(msg.sender, releasable);
        
        return releasable;
    }

    /**
     * @dev Calcula a quantidade de tokens que podem ser liberados
     * @param beneficiary Endereço do beneficiário
     * @return amount Quantidade de tokens disponíveis para liberação
     */
    function _computeReleasableAmount(address beneficiary) private view returns (uint256) {
        VestingSchedule storage schedule = _vestingSchedules[beneficiary];
        require(schedule.active, "Vesting nao ativo");

        if (block.timestamp < schedule.startTime + schedule.cliff) {
            return 0;
        } else if (block.timestamp >= schedule.startTime + schedule.duration) {
            return schedule.totalAmount - schedule.released;
        } else {
            uint256 elapsedTime = block.timestamp - (schedule.startTime + schedule.cliff);
            uint256 totalVestingTime = schedule.duration - schedule.cliff;
            uint256 totalReleasable = (schedule.totalAmount * elapsedTime) / totalVestingTime;
            return totalReleasable - schedule.released;
        }
    }

    /**
     * @dev Revoga um vesting schedule (apenas para schedules revogáveis)
     * @param beneficiary Endereço do beneficiário
     * @return amount Quantidade não liberada que foi revogada
     */
    function revokeVesting(address beneficiary) 
        external 
        requireMultipleApprovals(keccak256(abi.encodePacked("revokeVesting", beneficiary))) 
        onlyRole(GOVERNANCE_ROLE)
        returns (uint256 amount) 
    {
        VestingSchedule storage schedule = _vestingSchedules[beneficiary];
        require(schedule.active, "LoraToken: vesting nao existe");
        require(!schedule.revoked, "LoraToken: vesting ja revogado");
        require(schedule.revocable, "LoraToken: vesting nao revogavel");
        
        uint256 unreleased = schedule.totalAmount - schedule.released;
        schedule.revoked = true;
        
        // Devolver tokens não liberados ao supply disponível
        _remainingSupply += unreleased;
        
        emit VestingRevoked(beneficiary, unreleased);
        return unreleased;
    }

    /**
     * @dev Permite a liberação de fundos de emergência dos vestings
     * Uso exclusivo para situações críticas aprovadas pelo multisig de emergência
     * @return success Indica se a operação foi bem-sucedida
     */
    function emergencyVestingWithdrawal(address beneficiary, uint256 amount) 
        external 
        requireMultipleApprovals(keccak256(abi.encodePacked("emergency", beneficiary, amount)))
        onlyRole(EMERGENCY_ROLE)
        returns (bool success)
    {
        VestingSchedule storage schedule = _vestingSchedules[beneficiary];
        require(schedule.active, "LoraToken: vesting nao existe");
        require(!schedule.revoked, "LoraToken: vesting ja revogado");
        
        uint256 unreleased = schedule.totalAmount - schedule.released;
        require(amount <= unreleased, "LoraToken: valor maior que disponivel");
        
        // Ajustar o total do vesting e atualizar estado
        schedule.totalAmount -= amount;
        _mint(beneficiary, amount);
        
        emit EmergencyVestingWithdrawal(beneficiary, amount);
        return true;
    }

    // ================ FUNÇÕES DE MINT ================

    /**
     * @dev Solicita a criação de novos tokens
     * @param to Endereço do destinatário
     * @param amount Quantidade de tokens a serem emitidos
     * @return requestId ID do pedido de mint
     */
    function requestMint(address to, uint256 amount) external onlyRole(MINTER_ROLE) whenNotPaused returns (uint256 requestId) {
        require(to != address(0), "LoraToken: endereco zero");
        require(amount > 0, "LoraToken: quantidade zero");
        require(amount <= MAX_MINT_AMOUNT_PER_TX, "LoraToken: acima do limite por tx");
        require(_remainingSupply >= amount, "LoraToken: supply insuficiente");
        require(_whitelist[to], "LoraToken: endereco nao esta na whitelist");
        require(
            block.timestamp >= lastMintByMinter[msg.sender] + MINT_COOLING_PERIOD,
            "LoraToken: periodo de espera entre mints"
        );
        
        requestId = mintRequestCount++;
        MintRequest storage request = mintRequests[requestId];
        request.to = to;
        request.amount = amount;
        request.approved = false;
        request.approvalCount = 1;
        request.approvers[msg.sender] = true;
        
        emit MintRequested(requestId, msg.sender, to, amount);
        return requestId;
    }
    
    /**
     * @dev Aprova um pedido de mint pendente
     * @param requestId ID do pedido de mint
     * @return success Indica se a aprovação foi bem-sucedida
     */
    function approveMint(uint256 requestId) external onlyRole(MINTER_ROLE) whenNotPaused returns (bool success) {
        MintRequest storage request = mintRequests[requestId];
        require(request.amount > 0, "LoraToken: pedido inexistente");
        require(!request.approved, "LoraToken: ja aprovado");
        require(!request.approvers[msg.sender], "LoraToken: ja aprovou");
        
        request.approvers[msg.sender] = true;
        request.approvalCount += 1;
        
        emit MintApproved(requestId, msg.sender);
        
        if (request.approvalCount >= requiredMintApprovals) {
            _executeMint(requestId);
        }
        
        return true;
    }
    
    /**
     * @dev Executa um mint aprovado
     * @param requestId ID do pedido de mint
     */
    function _executeMint(uint256 requestId) private {
        MintRequest storage request = mintRequests[requestId];
        require(_remainingSupply >= request.amount, "LoraToken: supply insuficiente agora");
        
        request.approved = true;
        _mint(request.to, request.amount);
        _remainingSupply -= request.amount;
        lastMintTimestamp = block.timestamp;
        lastMintByMinter[msg.sender] = block.timestamp;
        
        emit MintExecuted(requestId, request.to, request.amount);
    }

    /**
     * @dev Libera a emissão anual de tokens (10% do MAX_SUPPLY)
     * Restrito ao papel de governança com período de timelock
     * @return amount Quantidade de tokens liberados
     */
    function releaseAnnualTokens() 
        external 
        validTimelock
        onlyRole(GOVERNANCE_ROLE) 
        whenNotPaused 
        returns (uint256 amount) 
    {
        require(block.timestamp >= lastMintTimestamp + YEAR_PERIOD, "LoraToken: periodo anual nao concluido");
        
        // Verificação melhorada para garantir que a chamada venha do timelock
        require(
            msg.sender == address(timelock) || 
            (timelock.hasRole(timelock.EXECUTOR_ROLE(), msg.sender) && 
             timelock.isOperation(keccak256(abi.encodePacked("releaseAnnual", block.timestamp)))),
            "LoraToken: precisa vir do timelock"
        );
        
        uint256 amountToMint = (MAX_SUPPLY * 10) / 100;
        require(_remainingSupply >= amountToMint, "LoraToken: supply insuficiente");
        
        address governance = hasRole(GOVERNANCE_ROLE, msg.sender) ? 
            msg.sender : address(timelock);
        
        _mint(governance, amountToMint);
        _remainingSupply -= amountToMint;
        lastMintTimestamp = block.timestamp;
        
        emit AnnualTokensReleased(governance, amountToMint);
        return amountToMint;
    }

    // ================ FUNÇÕES RWA (REAL WORLD ASSETS) ================

    /**
     * @dev Registra uma nova garantia de asset do mundo real
     * @param assetType Tipo de asset (ex: "Real Estate", "Commodities")
     * @param description Descrição detalhada do asset
     * @param documentHash Hash IPFS dos documentos comprovativos
     * @param assetValue Valor estimado do asset em unidades (18 decimais)
     * @param assetLocation Localização física ou jurídica do asset
     * @return assetId ID do asset registrado
     */
    function registerRWAsset(
        string memory assetType,
        string memory description,
        string memory documentHash,
        uint256 assetValue,
        string memory assetLocation
    ) 
        external 
        onlyRole(GOVERNANCE_ROLE)
        returns (uint256 assetId) 
    {
        require(bytes(assetType).length > 0, "LoraToken: tipo de asset vazio");
        require(bytes(documentHash).length > 0, "LoraToken: hash de documento vazio");
        require(assetValue > 0, "LoraToken: valor do asset zero");
        
        assetId = assetCount++;
        
        backedAssets[assetId] = AssetData({
            assetType: assetType,
            description: description,
            documentHash: documentHash,
            verificationTimestamp: 0,  // Ainda não verificado
            verifier: address(0),
            assetValue: assetValue,
            assetLocation: assetLocation,
            active: true
        });
        
        emit AssetRegistered(assetId, assetType, assetValue, documentHash);
        return assetId;
    }
    
    /**
     * @dev Verifica um asset RWA registrado
     * @param assetId ID do asset a ser verificado
     * @return success Indica se a verificação foi bem-sucedida
     */
    function verifyRWAsset(uint256 assetId) 
        external 
        requireMultipleApprovals(keccak256(abi.encodePacked("verifyAsset", assetId)))
        onlyRole(GOVERNANCE_ROLE)
        returns (bool success)
    {
        AssetData storage asset = backedAssets[assetId];
        require(asset.active, "LoraToken: asset nao existe ou nao esta ativo");
        require(asset.verificationTimestamp == 0, "LoraToken: asset ja verificado");
        
        asset.verificationTimestamp = block.timestamp;
        asset.verifier = msg.sender;
        totalAssetValue += asset.assetValue;
        
        emit AssetVerified(assetId, msg.sender);
        return true;
    }
    
    /**
     * @dev Desativa um asset RWA quando ele não é mais válido
     * @param assetId ID do asset a ser desativado
     * @return success Indica se a desativação foi bem-sucedida
     */
    function deactivateRWAsset(uint256 assetId)
        external
        requireMultipleApprovals(keccak256(abi.encodePacked("deactivateAsset", assetId)))
        onlyRole(GOVERNANCE_ROLE)
        returns (bool success)
    {
        AssetData storage asset = backedAssets[assetId];
        require(asset.active, "LoraToken: asset nao existe ou ja foi desativado");
        require(asset.verificationTimestamp > 0, "LoraToken: asset nao verificado");
        
        asset.active = false;
        totalAssetValue -= asset.assetValue;
        
        emit AssetDeactivated(assetId);
        return true;
    }

    // ================ FUNÇÕES DE ORÁCULO ================

    /**
     * @dev Atualiza o preço do token a partir do feed Chainlink
     * @return price Preço atualizado
     */
    function updatePrice() external onlyRole(ORACLE_ROLE) returns (uint256 price) {
        return _updatePrice();
    }
    
    /**
     * @dev Implementação interna para atualizar o preço
     */
    function _updatePrice() private returns (uint256) {
        require(address(priceFeed) != address(0), "LoraToken: feed de preco nao configurado");
        
        try priceFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            require(price > 0, "LoraToken: preco invalido");
            require(updatedAt > 0, "LoraToken: timestamp invalido");
            require(answeredInRound >= roundId, "LoraToken: dado desatualizado");
            
            currentPrice = uint256(price);
            lastPriceUpdate = updatedAt;
            
            emit PriceUpdated(currentPrice, lastPriceUpdate);
            return currentPrice;
        } catch {
            revert("LoraToken: erro ao obter dados do feed");
        }
    }

    // ================ FUNÇÕES DE LIQUIDEZ ================

    /**
     * @dev Adiciona tokens à reserva de liquidez
     * @param amount Quantidade de tokens a adicionar
     */
    function addLiquidity(uint256 amount) 
        external 
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
    {
        require(balanceOf(msg.sender) >= amount, "LoraToken: saldo insuficiente");
        _transfer(msg.sender, address(this), amount);
        liquidityBalance += amount;
        emit LiquidityAdded(amount);
    }

    /**
     * @dev Remove tokens da reserva de liquidez
     * @param amount Quantidade de tokens a remover
     */
    function removeLiquidity(uint256 amount) 
        external 
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
    {
        require(liquidityBalance >= amount, "LoraToken: saldo de liquidez insuficiente");
        liquidityBalance -= amount;
        _transfer(address(this), msg.sender, amount);
        emit LiquidityRemoved(amount);
    }

    /**
     * @dev Atualiza o endereço do pool de liquidez
     * @param newPool Novo endereço do pool
     */
    function updateLiquidityPool(address newPool) 
        external 
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
        whenNotPaused
    {
        require(newPool != address(0), "LORA: endereco zero invalido");
        require(newPool.code.length > 0, "LORA: deve ser um contrato");

        // Verificação adicional para pools DEX
        (bool success,) = newPool.call(abi.encodeWithSignature("factory()"));
        require(success, "LORA: pool invalido");

        address oldPool = liquidityPool;
        liquidityPool = newPool;
        
        _approve(address(this), newPool, type(uint256).max);
        emit LiquidityPoolUpdated(oldPool, newPool);
    }

    function getCurrentPool() external view returns (address) {
        return liquidityPool;
    }

    // ================ FUNÇÕES DE SEGURANÇA ================

    /**
     * @dev Permite recuperar tokens ERC20 enviados acidentalmente
     */
    function recoverERC20(address tokenAddress, uint256 amount) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
        nonReentrant
    {
        require(tokenAddress != address(this), "LORA: nao pode recuperar tokens LORA");
        IERC20(tokenAddress).safeTransfer(msg.sender, amount);
    }

    receive() external payable {
        revert("LORA: nao aceita ETH diretamente");
    }

    fallback() external payable {
        revert("LORA: funcao nao existente");
    }

} 
