const https = require('https');

async function probe() {
    const url = 'https://gmgn.ai/defi/quotation/v1/rank/sol/wallets/7d?orderby=pnl_7d&direction=desc';
    console.log("Probing GMGN Rank API:", url);

    return new Promise((resolve) => {
        https.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Referer": "https://gmgn.ai/discover/solana?tab=smart_money&period=7d"
            }
        }, (res) => {
            console.log("Status Code:", res.statusCode);
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        console.log("Success! Found", json.data?.rank?.length || 0, "wallets.");
                        if (json.data?.rank?.length > 0) {
                            console.log("First wallet sample:", json.data.rank[0].address);
                        }
                    } catch (e) {
                        console.log("JSON Parse Error. Raw data starts with:", data.substring(0, 500));
                    }
                } else {
                    console.log("Failed. Status:", res.statusCode);
                    console.log("Response starts with:", data.substring(0, 500));
                }
                resolve();
            });
        }).on('error', (e) => {
            console.log("Network Error:", e.message);
            resolve();
        });
    });
}

probe();
