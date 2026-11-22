"""Read-only F2Pool adapters for the owner's fixed shared mining accounts.

Fixed URLs only: callers cannot supply accounts, hosts or arbitrary actions.
No authenticated F2Pool API key or worker IPs are exposed.
"""
import json
import math
import os
import re
from html.parser import HTMLParser
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# Owner-local configuration: never publish share identifiers or account names.
SHARE = os.environ.get('F2POOL_SHARE', '')
ACCOUNTS = {
    'btc': {'account': os.environ.get('F2POOL_BTC_ACCOUNT', ''), 'path': 'mining-user', 'unit': 'TH/s', 'scale': 1e12},
    'aleo': {'account': os.environ.get('F2POOL_ALEO_ACCOUNT', ''), 'path': 'mining-user-aleo', 'unit': 'Mproof/s', 'scale': 1e6},
    'prl': {'account': os.environ.get('F2POOL_PRL_ACCOUNT', ''), 'path': 'mining-user-prl', 'unit': 'TH/s', 'scale': 1e12},
}


class RevenueParser(HTMLParser):
    """Identify money by its label AND currency, never by page ordering."""
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self):
        super().__init__()
        self.stack = []
        self.record = None
        self.fields = {}

    def handle_starttag(self, tag, attrs):
        if tag in self.VOID:
            return
        classes = set(dict(attrs).get('class', '').split())
        self.stack.append((tag, classes))
        if tag == 'div' and 'item-val' in classes and self.record is None:
            self.record = {'depth': len(self.stack), 'title': '', 'value': '', 'currency': ''}

    def handle_startendtag(self, tag, attrs):
        if tag not in self.VOID:
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)

    def handle_data(self, text):
        if self.record is None:
            return
        classes = set().union(*(c for _, c in self.stack[self.record['depth']:]))
        if 'title' in classes:
            self.record['title'] += text
        elif 'val' in classes or 'balance-num' in classes:
            self.record['value'] += text
        elif 'code' in classes:
            self.record['currency'] += text

    def handle_endtag(self, tag):
        index = next((i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if index is None:
            return
        if self.record and index < self.record['depth']:
            record = self.record
            self.record = None
            label = ' '.join(record['title'].lower().replace('’', "'").split())
            key = next((key for prefix, key in [('total income', 'total'), ('total payout', 'paid'),
                        ('balance', 'balance')] if label.startswith(prefix)), None)
            if key:
                value, currency = record['value'].strip(), record['currency'].strip()
                if key in self.fields or not re.fullmatch(r'\d+(?:\.\d+)?', value):
                    raise ValueError('Ambiguous F2Pool revenue field')
                self.fields[key] = (value, currency)
        del self.stack[index:]

    def revenue(self, coin):
        # Only depend on the money fields actually displayed by the dashboard.
        required = {'total', 'paid', 'balance'}
        if set(self.fields) != required or any(currency != coin.upper() for _, currency in self.fields.values()):
            raise ValueError('F2Pool revenue labels or currency changed')
        return {key: value for key, (value, _) in self.fields.items()}


def source_url(coin):
    config = ACCOUNTS[coin]
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', SHARE) or not config['account']:
        raise ValueError('Owner-local F2Pool configuration is missing or invalid')
    return f'https://www.f2pool.com/{config["path"]}/{SHARE}?' + urlencode({'user_name': config['account']})


def request(coin, **params):
    url = source_url(coin)
    if params:
        url += '&' + urlencode({'params': urlencode({'user_name': ACCOUNTS[coin]['account']}), **params})
    headers = {'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9'}
    if params:
        headers['X-Requested-With'] = 'XMLHttpRequest'
    with urlopen(Request(url, headers=headers), timeout=8) as response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError('Upstream response too large')
    if not params:
        return raw.decode('utf-8')
    data = json.loads(raw)
    if data.get('status') != 'ok':
        raise ValueError('F2Pool source unavailable')
    return data


def validate_series(series, percent=False):
    if not isinstance(series, dict) or not isinstance(series.get('values'), list):
        raise ValueError('Missing F2Pool graph series')
    previous = 0
    for point in series['values']:
        if not isinstance(point, list) or len(point) < 2:
            raise ValueError('Malformed F2Pool graph point')
        at, value = point[:2]
        if not all(type(v) in (int, float) and math.isfinite(v) for v in (at, value)) or at <= previous or value < 0 or (percent and value > 100):
            raise ValueError('Invalid F2Pool graph reading')
        previous = at


def load(coin, view):
    config = ACCOUNTS[coin]
    if view == 'summary':
        parser = RevenueParser()
        parser.feed(request(coin))
        revenue = parser.revenue(coin)
        workers = request(coin, action='get_pagination_workers', currency=coin.upper(),
                          account=config['account'], start=0, length=10, tagOnly=0,
                          tagview='true', tab='all', hashrate_type='real_time')['originData']
        counts = {key: workers['worker_length_' + key] for key in ('all', 'online', 'offline', 'dead')}
        if any(type(v) is not int or v < 0 for v in counts.values()) or counts['all'] != counts['online'] + counts['offline']:
            raise ValueError('Inconsistent F2Pool worker counts')
        stats = workers['summary']
        rates = [float(stats[k]) / config['scale'] for k in ('hash_rate', 'hash_rate_daily')]
        if not all(math.isfinite(v) and v >= 0 for v in rates):
            raise ValueError('Invalid F2Pool hashrate')
        return dict(account=config['account'], coin=coin.upper(), unit=config['unit'],
                    source_url=source_url(coin), hashrate=rates[0], hashrate_24h=rates[1],
                    rejected_percent=stats['reject_rate'],
                    revenue=revenue,
                    workers=counts)
    if view in ('day', 'month'):
        data = request(coin, action='load_by_duration', duration=1 if view == 'day' else 30)['data']
        history = data['hashrate_history']
        if history['key'] != f'{coin.upper()} ({config["unit"]})':
            raise ValueError('Wrong F2Pool currency or hashrate unit')
        validate_series(history)
        rejected = data.get('hashrate_history_stale_rate')
        if rejected is not None:
            validate_series(rejected, percent=True)
        return {'hashrate': history, 'rejected': rejected,
                'duration': view}
    if view in ('distribution', 'distribution-day'):
        return request(coin, action='load_hashrate_distribution', currency=coin, tag=0,
                       hashrate_type='real_time' if view == 'distribution' else '24h')['data']['worker_hashrate_distribution']
    if coin == 'btc' and view in ('online-day', 'online-month'):
        return request(coin, action='load_online_chart', currency=coin,
                       duration=1 if view == 'online-day' else 30)['data']['online_worker_chart_list']
    raise ValueError('Unsupported mining view')


# The HTTP handler only routes these exact paths.
SOURCES = {}
for coin in ACCOUNTS:
    views = ['summary', 'day', 'month', 'distribution', 'distribution-day']
    if coin == 'btc':
        views += ['online-day', 'online-month']
    for view in views:
        SOURCES[f'/api/crypto/mining/{coin}/{view}'] = (coin, view)
