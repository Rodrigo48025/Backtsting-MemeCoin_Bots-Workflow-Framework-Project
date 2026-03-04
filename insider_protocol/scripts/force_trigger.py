import argparse
import redis
import json
import time

def force_trigger(mint: str, trader: str, market_cap: float):
    # Connect to the Redis instance used by the Insider Protocol
    r = redis.Redis(host='localhost', port=6379, db=0)

    # Construct the TriggerPayload expected by the Sniper
    payload = {
        "mint": mint,
        "insider_address": trader,
        "funding_source": "MANUAL_PING",
        "market_cap": market_cap
    }

    payload_str = json.dumps(payload)
    
    print(f"🔧 [PING TEST] Publishing mock payload to 'insider_triggers'...")
    print(f"Payload: {payload_str}")

    # Publish to the channel
    clients_received = r.publish('insider_triggers', payload_str)
    
    if clients_received > 0:
        print(f"✅ Success! Payload delivered to {clients_received} listening clients (should be the Sniper).")
    else:
        print(f"⚠️ Warning: Payload published, but no clients were actively listening to 'insider_triggers'. Is the sniper running?")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Force a paper trade trigger into the Insider Protocol.")
    parser.add_argument("--mint", type=str, required=True, help="The token Mint Address.")
    parser.add_argument("--trader", type=str, required=True, help="The supposed Insider Wallet Address.")
    parser.add_argument("--mc", type=float, default=10000.0, help="Simulated market cap in USD.")
    
    args = parser.parse_args()
    
    force_trigger(args.mint, args.trader, args.mc)
