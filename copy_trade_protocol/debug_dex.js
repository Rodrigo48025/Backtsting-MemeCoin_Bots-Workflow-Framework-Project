const https = require('https');

async function debugDex() {
    const url = 'https://api.dexscreener.com/latest/dex/search/?q=solana';
    console.log("Fetching:", url);
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            const json = JSON.parse(data);
            const pairs = json.pairs || [];
            console.log("Total Pairs Found:", pairs.length);
            const filtered = pairs.filter(p => p.chainId === 'solana' && p.volume?.h24 > 50000 && p.fdv > 100000);
            console.log("Filtered Pairs:", filtered.length);
            filtered.slice(0, 5).forEach(p => {
                console.log(`- ${p.baseToken.symbol} | Vol: ${p.volume?.h24} | FDV: ${p.fdv} | Address: ${p.baseToken.address}`);
            });
        });
    });
}
debugDex();
