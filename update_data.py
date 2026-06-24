#!/usr/bin/env python3
import os
import json
import sqlite3
import subprocess
import time

def run_local_cmd(cmd):
    try:
        res = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
        return res.stdout.strip(), res.returncode == 0
    except Exception as e:
        return f"Error: {e}", False

def run_ssh_cmd(cmd):
    # Escape quotes for nesting
    escaped_cmd = cmd.replace("'", "'\\''")
    ssh_prefix = "sshpass -p 'aarz1947' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 r-server@100.84.224.18"
    full_cmd = f"{ssh_prefix} '{escaped_cmd}'"
    try:
        res = subprocess.run(full_cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
        return res.stdout.strip(), res.returncode == 0
    except Exception as e:
        return f"Error: {e}", False

def get_health_stats():
    uptime_local, ok1 = run_local_cmd("uptime")
    loadavg_local, ok2 = run_local_cmd("cat /proc/loadavg")
    mem_local, ok3 = run_local_cmd("free -h | grep Mem")
    disk_local, ok4 = run_local_cmd("df -h / | tail -1")
    
    docker_local, ok5 = run_local_cmd("docker ps --format '{{.Names}}: {{.Status}}'")
    if not ok5 or not docker_local:
        docker_local = "Docker not available"
        
    hermes_proc_output, ok_hermes = run_local_cmd("pgrep -f hermes")
    hermes_running = "Running" if (ok_hermes and hermes_proc_output) else "Not running"
    
    uptime_r, ok_r1 = run_ssh_cmd("uptime")
    docker_r, ok_r2 = run_ssh_cmd("sudo docker ps --format '{{.Names}}: {{.Status}}'")
    mem_r, ok_r3 = run_ssh_cmd("free -h")
    disk_r, ok_r4 = run_ssh_cmd("df -h /")
    
    return {
        "local": {
            "uptime": uptime_local if ok1 else "Unavailable",
            "cpu": loadavg_local if ok2 else "Unavailable",
            "memory": mem_local if ok3 else "Unavailable",
            "disk": disk_local if ok4 else "Unavailable",
            "docker": docker_local,
            "hermes": hermes_running,
            "status": "healthy" if (ok1 and ok2 and ok3 and ok4) else "error"
        },
        "r_server": {
            "uptime": { "output": uptime_r, "ok": ok_r1 },
            "docker": { "output": docker_r, "ok": ok_r2 },
            "memory": { "output": mem_r, "ok": ok_r3 },
            "disk": { "output": disk_r, "ok": ok_r4 },
            "status": "healthy" if (ok_r1 and ok_r2 and ok_r3 and ok_r4) else "error"
        }
    }

def parse_job(j):
    job_id = j.get("job_id") or j.get("id") or ""
    name = j.get("name") or "Unnamed Job"
    
    sched_val = j.get("schedule")
    schedule = ""
    if isinstance(sched_val, dict):
        schedule = sched_val.get("display") or sched_val.get("expr") or ""
    else:
        schedule = sched_val or j.get("schedule_display") or ""
        
    last_run = j.get("last_run_at") or j.get("last_run") or ""
    
    status = "ACTIVE"
    if "enabled" in j:
        status = "ACTIVE" if j["enabled"] else "PAUSED"
    elif "status" in j:
        status = j["status"]
        
    return {
        "job_id": job_id,
        "name": name,
        "schedule": schedule,
        "last_run": last_run,
        "status": status
    }

def get_cron_jobs():
    cron_dir = os.path.expanduser("~/.hermes/profiles/aarz/cron")
    jobs = []
    if not os.path.exists(cron_dir):
        return jobs
    
    # Read jobs.json specifically if it exists
    jobs_json = os.path.join(cron_dir, "jobs.json")
    if os.path.exists(jobs_json):
        try:
            with open(jobs_json) as file:
                data = json.load(file)
                if isinstance(data, dict) and "jobs" in data:
                    for j in data["jobs"]:
                        jobs.append(parse_job(j))
        except Exception as e:
            print(f"Error reading jobs.json: {e}")
            
    # Also read other json files if any, skipping backup files
    for f in os.listdir(cron_dir):
        if not f.endswith(".json") or f == "jobs.json" or "bak" in f:
            continue
        path = os.path.join(cron_dir, f)
        try:
            with open(path) as file:
                data = json.load(file)
                if isinstance(data, dict):
                    jobs.append(parse_job(data))
        except Exception as e:
            print(f"Error reading cron file {f}: {e}")
            
    return jobs

def get_kanban_tasks():
    tasks = []
    paths = [
        "/home/Aarz/.hermes/profiles/aarz/kanban.db",
        "/home/Aarz/.hermes/kanban.db"
    ]
    for path in paths:
        if not os.path.exists(path):
            continue
        try:
            conn = sqlite3.connect(path)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks';")
            if not cursor.fetchone():
                conn.close()
                continue
            cursor.execute("SELECT id, title, body, assignee, status, priority FROM tasks;")
            rows = cursor.fetchall()
            for r in rows:
                tasks.append({
                    "id": r[0],
                    "title": r[1],
                    "body": r[2] or "",
                    "assignee": r[3] or "unassigned",
                    "status": r[4], # e.g. todo, in_progress, done
                    "priority": r[5] or 0
                })
            conn.close()
            if tasks:
                break
        except Exception as e:
            print(f"Error querying sqlite db {path}: {e}")
    return tasks

def get_r_server_info():
    docker_ps, ok_ps = run_ssh_cmd("sudo docker ps -a --format '{{.Names}}\\t{{.Status}}\\t{{.Ports}}'")
    docker_images, ok_images = run_ssh_cmd("sudo docker images --format '{{.Repository}}\\t{{.Tag}}\\t{{.Size}}'")
    uptime, ok_up = run_ssh_cmd("uptime")
    free_h, ok_free = run_ssh_cmd("free -h")
    df_h, ok_df = run_ssh_cmd("df -h /")
    
    return {
        "docker_ps": { "output": docker_ps, "ok": ok_ps },
        "docker_images": { "output": docker_images, "ok": ok_images },
        "system": {
            "uptime": { "output": uptime, "ok": ok_up },
            "free_h": { "output": free_h, "ok": ok_free },
            "df_h": { "output": df_h, "ok": ok_df }
        }
    }

def main():
    print("Dashboard background data collector started.")
    output_dir = "/home/Aarz/agent-dashboard"
    os.makedirs(output_dir, exist_ok=True)
    
    while True:
        try:
            # 1. Health Stats
            health = get_health_stats()
            with open(os.path.join(output_dir, "health.json"), "w") as f:
                json.dump(health, f, indent=2)
                
            # 2. Missions (cron + kanban)
            cron = get_cron_jobs()
            kanban = get_kanban_tasks()
            with open(os.path.join(output_dir, "missions.json"), "w") as f:
                json.dump({"cron": cron, "kanban": kanban}, f, indent=2)
                
            # 3. r-server Control Panel Info
            r_server = get_r_server_info()
            with open(os.path.join(output_dir, "r_server_info.json"), "w") as f:
                json.dump(r_server, f, indent=2)
                
        except Exception as e:
            print(f"Error in data collector loop: {e}")
            
        time.sleep(30)

if __name__ == "__main__":
    main()
