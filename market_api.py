"""Fixed, public USDT market pairs for approximate mining-balance valuation."""
import json
from decimal import Decimal, InvalidOperation
from urllib.request import Request, urlopen

SOURCES = {
    '/api/crypto/price/btc': 'BTC_USDT',
    '/api/crypto/price/aleo': 'ALEO_USDT',
    # F2Pool calls native Pearl PRL; Gate's PRL is the unrelated Perle token.
    '/api/crypto/price/prl': 'PEARL_USDT',
}


def load(pair):
    if pair not in SOURCES.values():
        raise ValueError('Unsupported market')
    url = 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=' + pair
    with urlopen(Request(url, headers={'User-Agent': 'PiMonitor/1.0'}), timeout=8) as response:
        raw = response.read(65537)
    if len(raw) > 65536:
        raise ValueError('Market response too large')
    rows = json.loads(raw)
    if not isinstance(rows, list) or len(rows) != 1 or rows[0].get('currency_pair') != pair:
        raise ValueError('Unexpected market response')
    value = rows[0].get('last')
    try:
        price = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError('Invalid market price') from exc
    if not price.is_finite() or price <= 0:
        raise ValueError('Invalid market price')
    return {'pair': pair.replace('_', '/'), 'price': str(price), 'source': 'Gate', 'quote': 'USDT'}
