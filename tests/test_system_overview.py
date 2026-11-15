import json
import subprocess
import unittest
from unittest.mock import patch
import system_overview

class OverviewTests(unittest.TestCase):
    @patch('system_overview.pi_data.runtime_health', return_value={'status': 'Running'})
    @patch('system_overview.pi_data.jobs', return_value=[{'enabled': True}, {'enabled': False}])
    @patch('system_overview.subprocess.run')
    def test_inventory_and_privacy(self, run, jobs, health):
        def result(args, **kwargs):
            if args[0] == 'systemctl':
                return subprocess.CompletedProcess(args, 0, 'ActiveState=active\nSubState=running\n')
            return subprocess.CompletedProcess(args, 0, json.dumps({'echo': {
                'state': 'waiting-for-tunnel', 'enabled': True,
                'session': {'busy': False, 'session_id': 'PRIVATE-ID'}},
                'browser_pi_mode': 'waiting-for-harness', 'token': 'PRIVATE-TOKEN'}))
        run.side_effect = result
        data = system_overview.snapshot()
        self.assertEqual(len(data['services']), 6)
        self.assertEqual(data['schedules'], {'total': 2, 'enabled': 1})
        self.assertEqual(data['echo']['state'], 'waiting-for-tunnel')
        self.assertNotIn('PRIVATE', json.dumps(data))

    @patch('system_overview.pi_data.runtime_health', return_value={'status': 'Unavailable'})
    @patch('system_overview.pi_data.jobs', side_effect=OSError())
    @patch('system_overview.subprocess.run', side_effect=OSError())
    def test_unavailable_sources(self, run, jobs, health):
        data = system_overview.snapshot()
        self.assertTrue(all(s['state'] == 'unknown' for s in data['services']))
        self.assertIsNone(data['schedules'])
        self.assertEqual(data['echo']['state'], 'unavailable')
