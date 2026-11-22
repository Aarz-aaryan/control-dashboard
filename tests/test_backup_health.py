import copy
from datetime import datetime, timezone, timedelta
import unittest

import backup_health

NOW = datetime(2026, 11, 15, 23, tzinfo=timezone.utc)


def healthy():
    units = {name: {'ActiveState': 'inactive', 'Result': 'success'} for name in
             ['immich-backup.service', 'immich-backup-verify.service']}
    units.update({name: {'ActiveState': 'active', 'UnitFileState': 'enabled'} for name in
                  ['immich-backup.timer', 'immich-backup-verify.timer']})
    return {'units': units, 'drive_ok': True, 'repository_ok': True,
            'latest_snapshot': {'time': NOW.isoformat()},
            'verification': {'verified_at': NOW.isoformat(), 'full_repository_data_check': True},
            'disk': {'total': 3000 * 1024**3, 'used': 100 * 1024**3, 'free': 2900 * 1024**3}}


class BackupHealthTests(unittest.TestCase):
    def test_healthy(self):
        self.assertEqual(backup_health.evaluate(healthy(), NOW)['status'], 'healthy')

    def test_failure_even_with_recent_backup(self):
        raw = healthy()
        raw['units']['immich-backup.service']['Result'] = 'exit-code'
        self.assertEqual(backup_health.evaluate(raw, NOW)['status'], 'error')

    def test_missing_drive(self):
        raw = healthy(); raw['drive_ok'] = False
        self.assertEqual(backup_health.evaluate(raw, NOW)['status'], 'error')

    def test_overdue_backup(self):
        raw = healthy(); raw['latest_snapshot']['time'] = (NOW - timedelta(hours=31)).isoformat()
        self.assertEqual(backup_health.evaluate(raw, NOW)['status'], 'error')

    def test_future_backup_is_not_healthy(self):
        raw = healthy(); raw['latest_snapshot']['time'] = (NOW + timedelta(days=1)).isoformat()
        self.assertEqual(backup_health.evaluate(raw, NOW)['status'], 'error')

    def test_disabled_timer(self):
        raw = healthy(); raw['units']['immich-backup.timer']['UnitFileState'] = 'disabled'
        self.assertEqual(backup_health.evaluate(raw, NOW)['status'], 'error')

    def test_overdue_verification(self):
        raw = healthy(); raw['verification']['verified_at'] = (NOW - timedelta(days=10)).isoformat()
        self.assertEqual(backup_health.evaluate(raw, NOW)['status'], 'warning')

    def test_low_space(self):
        raw = healthy(); raw['disk']['free'] = 1024**3
        self.assertEqual(backup_health.evaluate(raw, NOW)['status'], 'error')

    def test_unknown_source(self):
        self.assertEqual(backup_health.evaluate(None, NOW)['status'], 'warning')

    def test_failed_and_malformed_ssh(self):
        for response in [('', False), ('not-json', True)]:
            self.assertEqual(backup_health.collect(lambda _: response)['status'], 'warning')

    def test_no_input_mutation(self):
        raw = healthy(); before = copy.deepcopy(raw)
        backup_health.evaluate(raw, NOW)
        self.assertEqual(raw, before)


if __name__ == '__main__':
    unittest.main()
