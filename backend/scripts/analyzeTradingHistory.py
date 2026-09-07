#!/usr/bin/env python3
"""Read-only trading audit; emit aggregates without account/order identifiers.

Usage: python3 backend/scripts/analyzeTradingHistory.py --db /path/app.db --user-id N
No API calls, credentials, database writes, or order-price fill assumptions.
"""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import re
import sqlite3
from statistics import mean, median


TABLES = {
    'strategies': 'created_at',
    'holdings': 'updated_at',
    'virtual_orders': 'created_at',
    'decision_logs': 'created_at',
    'auto_trading_strategies': 'created_at',
    'auto_trading_orders': 'created_at',
    'auto_trading_decision_logs': 'created_at',
    'auto_trading_position_snapshots': 'captured_at',
    'kr_rank_strategies': 'created_at',
    'kr_rank_orders': 'created_at',
    'kr_rank_entries': 'created_at',
    'kr_rank_decision_logs': 'created_at',
    'kr_rank_observations': 'observed_at',
    'us_rank_strategies': 'created_at',
    'us_rank_orders': 'created_at',
    'us_rank_trades': 'opened_at',
    'us_rank_decision_logs': 'created_at',
    'backtest_runs': 'created_at',
    'backtest_trades': 'created_at',
    'market_price_cache': 'created_at',
    'user_trading_setting_histories': 'changed_at',
}
ORDER_COLUMNS = '''id,strategy_id,symbol,currency,side,status,quantity,
    filled_quantity,average_filled_price,live_order_enabled,created_at,
    kis_order_no,error_message'''


def kst_date(value):
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return date.astimezone(timezone(timedelta(hours=9))).date().isoformat()


def rounded(value):
    return round(value, 8) if value is not None else None


def counts(rows, key):
    return dict(sorted(Counter(str(key(row)) for row in rows).items()))


def summarize_trades(trades, include_sequence_metrics=False):
    """One observation per fully closed buy lot; rates are not account returns."""
    if not trades:
        return {'closed_trades': 0}
    gross = [t['gross'] for t in trades]
    net = [t['net'] for t in trades if t['net'] is not None]
    rates = [t['gross'] / t['cost'] for t in trades]
    net_rates = [t['net'] / t['cost'] for t in trades if t['net'] is not None]

    def stats(values):
        positive = sum(v for v in values if v > 0)
        negative = -sum(v for v in values if v < 0)
        return {
            'count': len(values), 'sum': rounded(sum(values)) if values else None,
            'wins': sum(v > 0 for v in values), 'losses': sum(v < 0 for v in values),
            'flat': sum(v == 0 for v in values),
            'win_rate': rounded(sum(v > 0 for v in values) / len(values)) if values else None,
            'profit_factor': rounded(positive / negative) if negative else None,
        }

    equity = peak = drawdown = 0
    streak = worst_streak = 0
    for t in trades:
        value = t['net'] if t['net'] is not None else t['gross']
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
        streak = streak + 1 if value < 0 else 0
        worst_streak = max(worst_streak, streak)
    result = {
        'closed_trades': len(trades),
        'first_entry_kst': min(t['date'] for t in trades),
        'last_entry_kst': max(t['date'] for t in trades),
        'gross': stats(gross), 'broker_net': stats(net),
        'gross_return_mean': rounded(mean(rates)),
        'gross_return_median': rounded(median(rates)),
        'gross_return_min': rounded(min(rates)), 'gross_return_max': rounded(max(rates)),
        'mean_winning_gross_return': rounded(mean([r for r in rates if r > 0])) if any(r > 0 for r in rates) else None,
        'mean_losing_gross_return': rounded(mean([r for r in rates if r < 0])) if any(r < 0 for r in rates) else None,
        'net_return_mean': rounded(mean(net_rates)) if net_rates else None,
        'net_return_min': rounded(min(net_rates)) if net_rates else None,
        'gross_losses_at_least_5pct': sum(r <= -0.05 for r in rates),
        'fees': rounded(sum(t['fee'] for t in trades)) if len(net) == len(trades) else None,
        'taxes': rounded(sum(t['tax'] for t in trades)) if len(net) == len(trades) else None,
    }
    if include_sequence_metrics:
        result.update({
            'max_consecutive_losses': worst_streak,
            'closed_trade_pnl_drawdown_amount_not_account_mdd': rounded(drawdown),
        })
    return result


def pair_fills(orders):
    """Match explicit entry/trade first; legacy NULL sells use same-symbol FIFO.

    This is an analytical join only. It never assigns live account holdings to a
    strategy or changes database state. Missing quantity/price is not inferred.
    """
    lots = defaultdict(list)
    closed = []
    checks = Counter()
    for o in sorted(orders, key=lambda r: (r['created_at'], r['id'])):
        if not o['live_order_enabled']:
            continue
        qty = o['filled_quantity'] or 0
        price = o['average_filled_price'] or 0
        if qty <= 0 or price <= 0:
            if o['status'] == 'FILLED' or qty > 0:
                checks['fill_missing_quantity_or_price'] += 1
            continue
        if qty > o['quantity']:
            checks['fill_exceeds_order_quantity'] += 1
            continue
        key = (o['strategy_id'], o['symbol'], o['currency'])
        identity = o.get('entry_id', o.get('trade_id'))
        if o['side'] == 'BUY':
            lots[key].append({
                'identity': identity, 'remaining': qty, 'cost': qty * price,
                'buy_price': price, 'gross': 0, 'net': 0, 'net_complete': True,
                'fee': 0, 'tax': 0, 'window': o.get('entry_window', 'US'),
                'date': kst_date(o['created_at']), 'exit_reason': None,
            })
            continue
        eligible = [lot for lot in lots[key] if lot['remaining'] > 0
                    and (identity is None or lot['identity'] == identity)]
        if identity is None:
            checks['legacy_sell_without_entry_id'] += 1
            if len(eligible) != 1:
                checks['legacy_sell_ambiguous_buy_lots'] += 1
                checks['unmatched_sell_quantity'] += qty
                continue
        else:
            checks['sell_with_explicit_position_id'] += 1
        remaining = qty
        for lot in eligible:
            matched = min(remaining, lot['remaining'])
            share = matched / qty
            lot['gross'] += matched * (price - lot['buy_price'])
            if o.get('realized_profit_amount') is None:
                lot['net_complete'] = False
            else:
                lot['net'] += o['realized_profit_amount'] * share
            lot['fee'] += (o.get('realized_fee_amount') or 0) * share
            lot['tax'] += (o.get('realized_tax_amount') or 0) * share
            lot['remaining'] -= matched
            remaining -= matched
            lot['exit_reason'] = o.get('sell_reason')
            if lot['remaining'] <= 1e-9:
                if not lot['net_complete']:
                    lot['net'] = None
                closed.append(lot)
            if remaining <= 1e-9:
                break
        if remaining > 1e-9:
            checks['unmatched_sell_quantity'] += remaining
    checks['open_filled_buy_lots'] = sum(lot['remaining'] > 1e-9 for ls in lots.values() for lot in ls)
    return closed, dict(checks)


def decision_category(reason):
    if '접수됐으나 아직 체결되지 않아' in reason:
        return 'pending_buy_wait'
    if '최초 선택가' in reason and ('급락' in reason or '상승' in reason):
        return 'confirmation_price_move'
    if '주문 전 재검증에서 제외' in reason:
        return 'confirmation_filter_rejection'
    if '후보를' in reason and '선택했습니다' in reason:
        return 'candidate_selected'
    if '시작 후 5분' in reason:
        return 'selection_window_expired'
    if 'shadow' in reason:
        return 'shadow_only'
    if '매수 대상이 없어' in reason or '후보가 없' in reason:
        return 'no_candidate'
    return 'other'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True)
    parser.add_argument('--user-id', required=True, type=int)
    args = parser.parse_args()
    uri = Path(args.db).resolve().as_uri() + '?mode=ro'
    db = sqlite3.connect(uri, uri=True)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    db.execute('BEGIN')
    user_id = args.user_id

    def rows(table, columns='*'):
        assert table in TABLES
        return [dict(r) for r in db.execute(
            f'SELECT {columns} FROM {table} WHERE user_id=?', (user_id,))]

    output = {'generated_at_utc': datetime.now(timezone.utc).isoformat(),
              'scope': 'selected user; system totals contain no identities',
              'inventory': {}, 'orders': {}, 'decisions': {}}
    for table, time_col in TABLES.items():
        scope = db.execute(
            f'SELECT count(*) n,min({time_col}) first,max({time_col}) last FROM {table} WHERE user_id=?',
            (user_id,)).fetchone()
        output['inventory'][table] = {
            'selected_count': scope['n'],
            'system_count': db.execute(f'SELECT count(*) FROM {table}').fetchone()[0],
            'first_stored_timestamp': scope['first'], 'last_stored_timestamp': scope['last'],
        }
    by_family = {}
    for family in ['kr_rank', 'us_rank', 'auto_trading']:
        extra = ',entry_id,entry_window,sell_reason,realized_profit_amount,realized_fee_amount,realized_tax_amount' if family == 'kr_rank' else ',trade_id,sell_reason' if family == 'us_rank' else ''
        orders = rows(f'{family}_orders', ORDER_COLUMNS + extra)
        by_family[family] = orders
        output['orders'][family] = {
            'status_side_mode': counts(orders, lambda r: f"{r['side']}:{r['status']}:{'live' if r['live_order_enabled'] else 'dry'}"),
            'error_codes': counts([r for r in orders if r['error_message']], lambda r: ','.join(re.findall(r'\b(?:EGW|APBK|APCA|OPSQ|OPSP|IGW)[A-Z0-9]+\b', r['error_message'])) or 'unclassified'),
            'unresolved_count': sum(r['status'] in ['UNKNOWN', 'REQUESTED', 'ACCEPTED', 'PARTIALLY_FILLED'] for r in orders),
            'unresolved_without_broker_number': sum(r['status'] in ['UNKNOWN', 'REQUESTED', 'ACCEPTED', 'PARTIALLY_FILLED'] and not r['kis_order_no'] for r in orders),
        }
        decisions = rows(f'{family}_decision_logs', 'decision,reason,created_at')
        output['decisions'][family] = {
            'by_decision': counts(decisions, lambda r: r['decision']),
            'classified_reason': counts(decisions, lambda r: decision_category(r['reason'])),
            'pending_buy_wait_by_kst_date': counts([r for r in decisions if decision_category(r['reason']) == 'pending_buy_wait'], lambda r: kst_date(r['created_at'])),
        }
    for family in ['kr_rank', 'us_rank']:
        trades, checks = pair_fills(by_family[family])
        output[family] = {'fill_join_checks': checks, 'performance': summarize_trades(trades, include_sequence_metrics=True)}
        for group_name, get_key in [('by_entry_window', lambda t: t['window']),
                                    ('by_entry_month', lambda t: t['date'][:7]),
                                    ('by_exit_reason', lambda t: t['exit_reason'])]:
            groups = defaultdict(list)
            for trade in trades:
                groups[get_key(trade)].append(trade)
            output[family][group_name] = {k: summarize_trades(v) for k, v in sorted(groups.items())}
    entries = rows('kr_rank_entries', 'trade_date,entry_window,status,selection_mode')
    output['kr_rank']['entries_by_status'] = counts(entries, lambda r: r['status'])
    output['kr_rank']['entries_by_month_status'] = counts(entries, lambda r: f"{r['trade_date'][:7]}:{r['entry_window']}:{r['status']}")
    observations = rows('kr_rank_observations', 'strategy_id,trade_date,entry_window,observed_at,ranking_snapshot')
    windows = defaultdict(list)
    for row in observations:
        windows[(row['strategy_id'], row['trade_date'], row['entry_window'])].append(row)
    structural = defaultdict(Counter)
    for (_strategy_id, date, window), snapshots in sorted(windows.items()):
        last = max(snapshots, key=lambda r: r['observed_at'])
        ranking = json.loads(last['ranking_snapshot'])
        top = ranking[:10]
        lower, upper = (0.15, 0.20) if window == 'MORNING' else (0, 0.15)
        in_band = [r for r in top if isinstance(r.get('fluctuationRate'), (float, int)) and lower <= r['fluctuationRate'] < upper]
        stat = structural[window]
        stat['windows'] += 1
        stat['snapshots'] += len(snapshots)
        stat['last_snapshot_raw_top10_has_no_rate_band_candidate'] += not bool(in_band)
        stat['last_snapshot_full_top10'] += len(top) == 10
        stat['last_snapshot_tenth_rate_at_or_above_ceiling'] += len(top) == 10 and top[9]['fluctuationRate'] >= upper
    output['kr_rank']['retained_observations'] = {
        'first_date': min((r['trade_date'] for r in observations), default=None),
        'last_date': max((r['trade_date'] for r in observations), default=None),
        'unique_dates': len(set(r['trade_date'] for r in observations)),
        'by_window': {k: dict(v) for k, v in structural.items()},
    }
    us_trades = rows('us_rank_trades', 'status,entry_price,entry_quantity,exit_price')
    output['us_rank']['trade_table_status'] = counts(us_trades, lambda r: r['status'])
    output['us_rank']['trade_table_closed_gross_profit'] = rounded(sum(
        (r['exit_price'] - r['entry_price']) * r['entry_quantity']
        for r in us_trades if r['status'] == 'CLOSED' and r['exit_price'] is not None and r['entry_price'] is not None))
    runs = rows('backtest_runs', '''id,algorithm,symbol,market,currency,from_date,to_date,total_budget,
        split_count,target_profit_rate,big_buy_premium_rate,allow_fractional_shares,restart_after_sell,
        initial_lump_ratio,daily_amount,status,return_rate,max_drawdown_rate,initial_budget,final_asset''')
    bt_trades = rows('backtest_trades', 'run_id,side,price,quantity,amount,total_asset,trade_date,id')
    unique_keys = ['algorithm','symbol','market','currency','from_date','to_date','total_budget',
                   'split_count','target_profit_rate','big_buy_premium_rate','allow_fractional_shares',
                   'restart_after_sell','initial_lump_ratio','daily_amount']
    duplicates = Counter(tuple(r[k] for k in unique_keys) for r in runs)
    groups = defaultdict(list)
    for run in runs:
        groups[run['algorithm']].append(run)
    last_trade = {}
    for trade in sorted(bt_trades, key=lambda r: (r['trade_date'], r['id'])):
        last_trade[trade['run_id']] = trade
    output['backtests'] = {
        'run_statuses': counts(runs, lambda r: r['status']),
        'trade_sides': counts(bt_trades, lambda r: r['side']),
        'unique_full_parameter_sets': len(duplicates),
        'duplicate_extra_runs': sum(n-1 for n in duplicates.values()),
        'unique_symbol_date_windows': len(set((r['symbol'],r['from_date'],r['to_date']) for r in runs)),
        'final_asset_mismatch_count': sum(abs(r['final_asset']-last_trade[r['id']]['total_asset']) > 0.01 for r in runs if r['id'] in last_trade and r['final_asset'] is not None),
        'return_arithmetic_mismatch_count': sum(abs((r['final_asset']/r['initial_budget']-1)-r['return_rate']) > 1e-7 for r in runs if r['initial_budget'] and r['final_asset'] is not None),
        'trade_amount_mismatch_count': sum(abs(t['price']*t['quantity']-t['amount'])>0.01 for t in bt_trades if t['side'] in ['BUY','SELL']),
        'by_algorithm': {k: {
            'runs': len(v), 'symbols': sorted(set(r['symbol'] for r in v)),
            'min_return_rate': min(r['return_rate'] for r in v),
            'max_return_rate': max(r['return_rate'] for r in v),
            'largest_reported_drawdown_rate': max(r['max_drawdown_rate'] for r in v),
        } for k,v in sorted(groups.items())},
    }
    candles = rows('market_price_cache', 'market,currency,open,high,low,close,volume')
    snapshots = rows('auto_trading_position_snapshots', 'quantity,current_price,evaluation_amount')
    output['data_quality'] = {
        'cache_by_market': counts(candles, lambda r: r['market']),
        'cache_nonpositive_prices': sum(any(r[k] <= 0 for k in ['open','high','low','close']) for r in candles),
        'cache_invalid_ohlc': sum(r['low'] > min(r['open'],r['close'],r['high']) or r['high'] < max(r['open'],r['close'],r['low']) for r in candles),
        'cache_negative_volume': sum((r['volume'] or 0) < 0 for r in candles),
        'position_negative_quantity': sum(r['quantity'] < 0 for r in snapshots),
        'position_evaluation_mismatch': sum(abs(r['quantity']*r['current_price']-r['evaluation_amount']) > 0.01 for r in snapshots),
    }
    db.rollback()
    db.close()
    print(json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
