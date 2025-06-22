// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract LastMileCashPayments is AccessControl, ReentrancyGuard, ERC721 {
    using SafeERC20 for IERC20;

    /* ---------- Roles ---------- */
    bytes32 public constant BATCH_PROCESSOR_ROLE =
        keccak256("BATCH_PROCESSOR_ROLE");

    /* ---------- Storage ---------- */

    struct Batch {
        uint256 projectId; // which project this batch belongs to
        uint256 beneficiaries; // human-readable count (filled at process time)
        uint256 amount; // amount paid (filled at process time)
        bool processed; // true once funds transferred
    }

    struct Project {
        address donor;
        address organisation;
        IERC20 token;
        uint256 budget;
        uint256 paid;
        uint256 beneficiaries;
        bool prefunded;
        bool completed;
    }

    uint256 public nextProjectId = 1;
    uint256 public nextBatchId = 1;

    mapping(uint256 => Project) public projects;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => mapping(bytes32 => bool)) public processedBatches;

    string private _baseTokenURI;

    /* ---------- Events ---------- */
    event ProjectCreated(
        uint256 indexed projectId,
        address indexed donor,
        address indexed organisation,
        address token,
        uint256 budget,
        bool prefunded,
        string projectKey
    );
    event BatchCreated(uint256 indexed batchId, uint256 indexed projectId);
    event BatchProcessed(
        uint256 indexed projectId,
        uint256 indexed batchId,
        uint256 batchAmount,
        uint256 beneficiaryCount
    );
    event ProjectCompleted(
        uint256 indexed projectId,
        address donor,
        uint256 beneficiaries,
        uint256 paid
    );
    event BaseURISet(string oldBase, string newBase);
    event ProjectPrefunded(
        uint256 indexed projectId,
        address indexed donor,
        uint256 budget
    );

    /* ---------- Constructor ---------- */
    constructor(
        string memory baseURI_,
        string memory name_,
        string memory symbol_
    ) ERC721(name_, symbol_) {
        _baseTokenURI = baseURI_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /* ---------- Admin ---------- */
    function setBaseURI(
        string calldata newBase
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit BaseURISet(_baseTokenURI, newBase);
        _baseTokenURI = newBase;
    }

    /* ---------- Project lifecycle ---------- */
    function createProject(
        address organisation,
        IERC20 token,
        uint256 budget,
        address donor,
        string calldata projectKey
    ) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 projectId) {
        require(organisation != address(0), "organisation=0");
        require(budget > 0, "budget=0");

        projectId = nextProjectId++;
        projects[projectId] = Project({
            donor: donor,
            organisation: organisation,
            token: token,
            budget: budget,
            paid: 0,
            beneficiaries: 0,
            prefunded: false,
            completed: false
        });

        emit ProjectCreated(
            projectId,
            donor,
            organisation,
            address(token),
            budget,
            false,
            projectKey
        );
    }

    /**
        * @notice Prefund a project with tokens.
        * @dev This is used to transfer tokens from the donor to the contract
        * before any batches are processed. The donor can later withdraw any
        * unspent funds after the project is completed.
        * @param projectId ID of the project to prefund.
        * @dev The project must not be completed, must not have been paid yet,
        * and must not have been prefunded already.
     */

    function prefundProject(
        uint256 projectId
    ) external nonReentrant {
        Project storage p = projects[projectId];
        require(projectId != 0 && !p.completed, "invalid project");
        require(p.paid == 0, "already paid");
        require(!p.prefunded, "not prefunded");
        p.prefunded = true;
        p.token.safeTransferFrom(msg.sender, address(this), p.budget);
        emit ProjectPrefunded(
            projectId,
            msg.sender,
            p.budget
        );
    }

    /**
     * @notice Register a new batch for a given project.
     * @dev Callable by the same backend that later calls `processBatch`.
     */
    function createBatch(
        uint256 projectId
    ) external onlyRole(BATCH_PROCESSOR_ROLE) returns (uint256 batchId) {
        Project storage p = projects[projectId];
        require(projectId != 0 && !p.completed, "invalid project");

        batchId = nextBatchId++;
        batches[batchId] = Batch({
            projectId: projectId,
            beneficiaries: 0,
            amount: 0,
            processed: false
        });

        emit BatchCreated(batchId, projectId);
    }

    /**
     * @notice Pay a previously created batch.
     * @param batchId        ID returned by `createBatch`.
     * @param totalPaid      Tokens to transfer in this batch.
     * @param beneficiaries  Number of households in the batch.
     */
    function processBatch(
        uint256 batchId,
        uint256 totalPaid,
        uint256 beneficiaries
    ) external nonReentrant onlyRole(BATCH_PROCESSOR_ROLE) {
        Batch storage b = batches[batchId];
        require(!b.processed, "batch already processed");
        require(totalPaid > 0, "amount=0");

        Project storage p = projects[b.projectId];
        require(!p.completed, "project done");
        require(p.paid + totalPaid <= p.budget, "exceeds budget");

        /* effects */
        b.processed = true;
        b.amount = totalPaid;
        b.beneficiaries = beneficiaries;

        p.paid += totalPaid;
        p.beneficiaries += beneficiaries;

        /* interactions */
        if (p.prefunded) {
            p.token.safeTransfer(p.organisation, totalPaid);
        } else {
            p.token.safeTransferFrom(p.donor, p.organisation, totalPaid);
        }

        emit BatchProcessed(b.projectId, batchId, totalPaid, beneficiaries);
    }

    function completeProject(uint256 projectId) external nonReentrant {
        Project storage p = projects[projectId];
        require(!p.completed, "already done");
        require(
            msg.sender == p.donor || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "not authorised"
        );
        p.completed = true;

        if (p.prefunded && p.budget > p.paid) {
            p.token.safeTransfer(p.donor, p.budget - p.paid);
        }

        _safeMint(p.donor, projectId);
        emit ProjectCompleted(projectId, p.donor, p.beneficiaries, p.paid);
    }

    /* ---------- Views ---------- */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /**
     * @dev Needed because of multiple inheritance.
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(AccessControl, ERC721) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
