import subprocess
from datetime import datetime, timezone

# --- CONFIGURATION ---
LOG_PULSE_THRESHOLD_MINUTES = 5
CONTAINERS = {
    "scout": "insider_scout",
    "watcher": "insider_watcher",
    "sniper": "insider_sniper",
}
DB_CONTAINER = "insider_db"
REDIS_CONTAINER = "insider_redis"

def check_container_status():
    """Check if all Insider Protocol containers are running."""
    print("🔍 [WATCHTOWER 1] Container Status...")
    all_up = True
    for name, container in CONTAINERS.items():
        try:
            res = subprocess.run(
                ["docker", "inspect", "-f", "{{.State.Status}}", container],
                capture_output=True, text=True, timeout=5
            )
            status = res.stdout.strip()
            if status == "running":
                print(f"  ✅ {name.upper()}: RUNNING")
            else:
                print(f"  ❌ {name.upper()}: {status or 'NOT FOUND'}")
                all_up = False
        except Exception as e:
            print(f"  ❌ {name.upper()}: UNREACHABLE ({e})")
            all_up = False

    # Check infra containers
    for infra in [DB_CONTAINER, REDIS_CONTAINER]:
        try:
            res = subprocess.run(
                ["docker", "inspect", "-f", "{{.State.Status}}", infra],
                capture_output=True, text=True, timeout=5
            )
            status = res.stdout.strip()
            label = infra.replace("insider_", "").upper()
            if status == "running":
                print(f"  ✅ {label}: RUNNING")
            else:
                print(f"  ❌ {label}: {status or 'NOT FOUND'}")
                all_up = False
        except:
            all_up = False
    return all_up

def check_db_health():
    """Verify PostgreSQL connectivity and wallet seed."""
    print("🔍 [WATCHTOWER 2] Database Health...")
    try:
        res = subprocess.run(
            ["docker", "exec", DB_CONTAINER, "psql", "-U", "insider_user", "-d", "insider_db",
             "-t", "-c", "SELECT balance_sol FROM paper_wallets WHERE wallet_address='INSIDER_MAIN_WAREHOUSE'"],
            capture_output=True, text=True, timeout=10
        )
        balance = res.stdout.strip()
        if balance:
            print(f"  ✅ [DB] Warehouse Balance: {balance.strip()} SOL")
            return True
        else:
            print("  ❌ [DB] Warehouse wallet not found!")
            return False
    except Exception as e:
        print(f"  ❌ [DB] Connection failed: {e}")
        return False

def check_redis_health():
    """Verify Redis connectivity and watchlist state."""
    print("🔍 [WATCHTOWER 3] Redis Health...")
    try:
        # Ping
        res = subprocess.run(
            ["docker", "exec", REDIS_CONTAINER, "redis-cli", "ping"],
            capture_output=True, text=True, timeout=5
        )
        if "PONG" not in res.stdout:
            print("  ❌ [REDIS] Not responding to PING.")
            return False
        print("  ✅ [REDIS] PONG — Connection alive.")

        # Count watchlist keys
        res = subprocess.run(
            ["docker", "exec", REDIS_CONTAINER, "redis-cli", "keys", "watchlist:*"],
            capture_output=True, text=True, timeout=5
        )
        keys = [k for k in res.stdout.strip().split('\n') if k and k != '(empty array)']
        print(f"  📋 [REDIS] Watchlist entries: {len(keys)}")
        return True
    except Exception as e:
        print(f"  ❌ [REDIS] Connection failed: {e}")
        return False

def check_pulse_liveness():
    """Check for recent activity in bot logs."""
    print("🔍 [WATCHTOWER 4] Signal Pulse (Liveness)...")
    alive_count = 0

    # Scout: look for [DETECTIVE] signals
    scout_pulse = _get_pulse("insider_scout", ["[DETECTIVE]", "Analyzed Signal"])
    if scout_pulse is not None and scout_pulse <= LOG_PULSE_THRESHOLD_MINUTES:
        print(f"  ✅ [SCOUT] Active. Last signal {scout_pulse:.1f}m ago.")
        alive_count += 1
    elif scout_pulse is not None:
        print(f"  ⚠️  [SCOUT] Stale. Last signal {scout_pulse:.1f}m ago.")
    else:
        print("  ❌ [SCOUT] No signal detected in recent logs.")

    # Watcher: look for [MATCHER] signals
    watcher_pulse = _get_pulse("insider_watcher", ["[MATCHER]", "Matching Traders"])
    if watcher_pulse is not None and watcher_pulse <= LOG_PULSE_THRESHOLD_MINUTES:
        print(f"  ✅ [WATCHER] Active. Last signal {watcher_pulse:.1f}m ago.")
        alive_count += 1
    elif watcher_pulse is not None:
        print(f"  ⚠️  [WATCHER] Stale. Last signal {watcher_pulse:.1f}m ago.")
    else:
        print("  ❌ [WATCHER] No signal detected in recent logs.")

    # Sniper: look for [ASSASSIN] signals
    sniper_pulse = _get_pulse("insider_sniper", ["[ASSASSIN]", "Waiting for triggers"])
    if sniper_pulse is not None and sniper_pulse <= LOG_PULSE_THRESHOLD_MINUTES:
        print(f"  ✅ [SNIPER] Active. Last signal {sniper_pulse:.1f}m ago.")
        alive_count += 1
    elif sniper_pulse is not None:
        print(f"  ⚠️  [SNIPER] Stale. Last signal {sniper_pulse:.1f}m ago.")
    else:
        print("  ❌ [SNIPER] No signal detected in recent logs.")

    return alive_count >= 2  # At least 2 of 3 must be alive

def check_crash_loops():
    """Detect if services are crash-looping."""
    print("🔍 [WATCHTOWER 5] Crash Loop Detection...")
    issues = False
    for name, container in CONTAINERS.items():
        try:
            res = subprocess.run(
                ["docker", "logs", "--tail", "30", container],
                capture_output=True, text=True, timeout=5
            )
            crash_count = res.stdout.count("Crashed:") + res.stderr.count("Crashed:")
            tls_errors = res.stdout.count("TLS support not compiled") + res.stderr.count("TLS support not compiled")
            conn_refused = res.stdout.count("ECONNREFUSED") + res.stderr.count("ECONNREFUSED")

            if crash_count >= 3:
                print(f"  ⚠️  [{name.upper()}] Crash-looping! ({crash_count} crashes in recent logs)")
                issues = True
            elif tls_errors > 0:
                print(f"  ❌ [{name.upper()}] TLS not compiled — WebSocket dead.")
                issues = True
            elif conn_refused > 0:
                print(f"  ⚠️  [{name.upper()}] Connection refused errors detected.")
                issues = True
            else:
                print(f"  ✅ [{name.upper()}] No crash patterns detected.")
        except:
            pass

    return not issues

def check_trade_activity():
    """Check for recent trades in the database."""
    print("🔍 [WATCHTOWER 6] Trade Activity...")
    try:
        res = subprocess.run(
            ["docker", "exec", DB_CONTAINER, "psql", "-U", "insider_user", "-d", "insider_db",
             "-t", "-c", "SELECT COUNT(*) FROM insider_trades"],
            capture_output=True, text=True, timeout=10
        )
        count = int(res.stdout.strip())
        if count > 0:
            print(f"  ✅ [TRADES] {count} total trades recorded.")
        else:
            print(f"  📋 [TRADES] 0 trades — awaiting first insider match.")
        return True
    except Exception as e:
        print(f"  ❌ [TRADES] Query failed: {e}")
        return False


def _get_pulse(container, keywords):
    """Get minutes since last relevant log line for a container."""
    try:
        res = subprocess.run(
            ["docker", "logs", "--timestamps", "--tail", "50", container],
            capture_output=True, text=True, timeout=5
        )
        lines = res.stdout.strip().split('\n')
        for line in reversed(lines):
            if any(kw in line for kw in keywords):
                parts = line.split(' ')
                if not parts:
                    continue
                ts_str = parts[0]
                ts_clean = ts_str.split('.')[0].replace('Z', '').split('+')[0]
                ts_dt = datetime.fromisoformat(ts_clean).replace(tzinfo=timezone.utc)
                delta = datetime.now(timezone.utc) - ts_dt
                return delta.total_seconds() / 60
    except:
        pass
    return None


def run_audit():
    print("=" * 60)
    print(f"🕵️ INSIDER PROTOCOL — Systematic Health Audit")
    print(f"   {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    checks = [
        ("Containers", check_container_status()),
        ("Database", check_db_health()),
        ("Redis", check_redis_health()),
        ("Pulse", check_pulse_liveness()),
        ("Stability", check_crash_loops()),
        ("Trades", check_trade_activity()),
    ]

    passed = sum(1 for _, v in checks if v)
    total = len(checks)

    print("-" * 60)
    if passed == total:
        print(f"🟢 SYSTEM NOMINAL: Insider Protocol is healthy. ({passed}/{total})")
    elif passed >= total - 1:
        print(f"🟡 SYSTEM DEGRADED: Minor issues detected. ({passed}/{total})")
    else:
        print(f"🔴 SYSTEM CRITICAL: Multiple failures. ({passed}/{total})")
    print("=" * 60)


if __name__ == "__main__":
    run_audit()
