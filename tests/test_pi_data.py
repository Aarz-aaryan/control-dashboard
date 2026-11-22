import json
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

import pi_data
import update_data


class PiDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'state').mkdir()
        (self.root / 'jobs.json').write_text(json.dumps({'jobs': [
            {'id': 'one', 'name': 'Real job', 'enabled': False, 'schedule': {'expr': '* * * * *'}}]}))

    def test_only_canonical_jobs(self):
        with patch.object(pi_data, 'ROOT', self.root):
            jobs = update_data.get_cron_jobs()
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]['status'], 'PAUSED')
        self.assertEqual(jobs[0]['schedule'], '* * * * *')

    def test_runtime_counts_started_work_and_redacts_chat(self):
        now = time.time()
        with sqlite3.connect(self.root / 'state/runtime.db') as db:
            db.execute('CREATE TABLE runs(job_id,kind,state,scheduled,started,finished)')
            db.executemany('INSERT INTO runs VALUES(?,?,?,?,?,?)', [
                ('private-channel', 'chat', 'ok', now, now, now),
                ('one', 'cron', 'running', now, now, None),
                ('one', 'cron', 'queued', now, None, None),
            ])
        agents = pi_data.runtime_activity(self.root)
        self.assertEqual(agents['aarz']['sessions_24h'], 1)
        self.assertEqual(agents['pi-scheduler']['sessions_24h'], 1)
        self.assertEqual(agents['pi-scheduler']['running'], 1)
        self.assertEqual(agents['pi-scheduler']['queued'], 1)
        self.assertNotIn('private-channel', json.dumps(agents))

    def test_retired_jobs_excluded_from_current_activity_but_history_preserved(self):
        now = time.time()
        with sqlite3.connect(self.root / 'state/runtime.db') as db:
            db.execute('CREATE TABLE runs(job_id,kind,state,scheduled,started,finished)')
            db.executemany('INSERT INTO runs VALUES(?,?,?,?,?,?)', [
                ('one', 'cron', 'ok', now, now, now),
                ('retired-deck', 'cron', 'ok', now, now, now),
                ('retired-memory', 'cron', 'running', now, now, None),
                ('retired-memory', 'cron', 'queued', now, None, None),
            ])
        data = pi_data.runtime_activity(self.root)['pi-scheduler']
        self.assertEqual(data['sessions_24h'], 1)
        self.assertEqual(data['running'], 0)
        self.assertEqual(data['queued'], 0)
        self.assertNotIn('Scheduled job', json.dumps(data))
        with sqlite3.connect(self.root / 'state/runtime.db') as db:
            self.assertEqual(db.execute('SELECT count(*) FROM runs').fetchone()[0], 4)

    def test_jsonl_partial_line_and_no_mtime_activity(self):
        now = datetime.now(timezone.utc).isoformat()
        path = self.root / 'session.jsonl'
        path.write_text('\n'.join(json.dumps(x) for x in [
            {'type': 'session', 'timestamp': now},
            {'type': 'message', 'timestamp': now, 'message': {'role': 'user', 'content': 'SECRET'}},
            {'type': 'message', 'timestamp': now, 'message': {'role': 'assistant', 'content': []}},
        ]) + '\n{"type":')
        data = pi_data.session_activity(self.root)
        self.assertEqual(data['sessions_24h'], 1)
        self.assertEqual(data['recent'][0]['msgs'], 2)
        self.assertNotIn('SECRET', json.dumps(data))
        path.write_text(json.dumps({'type': 'session', 'timestamp': now}) + '\n')
        self.assertEqual(pi_data.session_activity(self.root)['sessions_24h'], 0)

    def test_stale_heartbeat_is_not_healthy(self):
        (self.root / 'state/heartbeat.json').write_text(json.dumps({'at': '2020-01-01T00:00:00Z'}))
        (self.root / 'state/health.json').write_text(json.dumps({'discord_connected': True}))
        with patch.object(pi_data, 'service_active', return_value=True):
            self.assertEqual(pi_data.runtime_health(self.root)['status'], 'Degraded')

    def test_missing_runtime_reports_unavailable(self):
        agents = pi_data.runtime_activity(self.root)
        self.assertTrue(agents['aarz']['error'])
        self.assertFalse((self.root / 'state/runtime.db').exists())


if __name__ == '__main__':
    unittest.main()
