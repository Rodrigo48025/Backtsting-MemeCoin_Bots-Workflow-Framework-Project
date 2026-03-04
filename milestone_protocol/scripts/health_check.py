import subprocess
from datetime import datetime, timezone

# --- CONFIGURATION ---
LOG_PULSE_THRESHOLD_MINUTES = 5

def check_429_errors():
    print("🔍 [WATCHTOWER 1] Checking API Rate Limits (429s)...")
    try:
        res = subprocess.run(["docker", "logs", "--tail", "50", "milestone_scout"], capture_output=True, text=True)
        if "429" in res.stdout or "Rate Limit" in res.stdout:
            print("⚠️ ALERT: Possible 429 Rate Limit detected!")
            return False
        print("✅ [API] No rate limiting detected in recent logs.")
        return True
    except:
        return False

def check_pulse_liveness():
    print("🔍 [WATCHTOWER 2] Checking System Pulse (Liveness)...")
    
    # Check Scout Log Pulse
    scout_pulse_min = None
    try:
        res = subprocess.run(["docker", "logs", "--timestamps", "--tail", "50", "milestone_scout"], capture_output=True, text=True)
        lines = res.stdout.strip().split('\n')
        for line in reversed(lines):
            if "[INGRESS]" in line or "[DISCOVERY]" in line:
                # 2026-02-24T18:56:40.579Z ...
                parts = line.split(' ')
                if not parts: continue
                ts_str = parts[0]
                ts_clean = ts_str.split('.')[0].replace('Z', '').split('+')[0]
                ts_dt = datetime.fromisoformat(ts_clean).replace(tzinfo=timezone.utc)
                delta = datetime.now(timezone.utc) - ts_dt
                scout_pulse_min = delta.total_seconds() / 60
                break
    except: pass

    # Check Sniper Log Pulse
    sniper_pulse_min = None
    try:
        res = subprocess.run(["docker", "logs", "--timestamps", "--tail", "50", "milestone_sniper"], capture_output=True, text=True)
        lines = res.stdout.strip().split('\n')
        for line in reversed(lines):
            if "[PROGRESS]" in line or "[DISCOVERY]" in line or "[WATCHER]" in line or "[SNIPED]" in line:
                parts = line.split(' ')
                if not parts: continue
                ts_str = parts[0]
                ts_clean = ts_str.split('.')[0].replace('Z', '').split('+')[0]
                ts_dt = datetime.fromisoformat(ts_clean).replace(tzinfo=timezone.utc)
                delta = datetime.now(timezone.utc) - ts_dt
                sniper_pulse_min = delta.total_seconds() / 60
                break
    except: pass

    alive = False
    if scout_pulse_min is not None and scout_pulse_min <= LOG_PULSE_THRESHOLD_MINUTES:
        print(f"✅ [PULSE] Scout active. Heartbeat {scout_pulse_min:.1f}m ago.")
        alive = True
    if sniper_pulse_min is not None and sniper_pulse_min <= LOG_PULSE_THRESHOLD_MINUTES:
        print(f"✅ [PULSE] Sniper active. Heartbeat {sniper_pulse_min:.1f}m ago.")
        alive = True

    if not alive:
        print("⚠️ ALERT: SYSTEM STAGNATION. No live signals detected in logs.")
        return False
    return True

def run_audit():
    print("="*50)
    print(f"🛡️ THE SENTINEL - Systematic Health Audit - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*50)
    
    health_score = 0
    if check_429_errors(): health_score += 1
    if check_pulse_liveness(): health_score += 1
    
    print("-"*50)
    if health_score == 2:
        print("🟢 SYSTEM NOMINAL: Milestone Protocol is healthy.")
    else:
        print(f"🔴 ALERT: SYSTEM DEGRADED.")
    print("="*50)

if __name__ == "__main__":
    run_audit()

