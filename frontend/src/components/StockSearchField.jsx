import React, { useEffect, useState } from 'react';
import { searchStocks } from '../api/client.js';

export function StockSearchField({
  stockCode,
  stockName,
  onSelect,
  onClear,
  clearSignal,
  label = '종목 검색',
  helper = '검색 결과를 선택하면 종목코드와 종목명이 자동으로 입력됩니다.'
}) {
  const [query, setQuery] = useState(formatDisplay(stockCode, stockName));
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    setQuery(formatDisplay(stockCode, stockName));
  }, [stockCode, stockName]);

  useEffect(() => {
    if (clearSignal === undefined) return;
    setQuery('');
    setResults([]);
    setHint('');
  }, [clearSignal]);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword || keyword.includes(' · ')) {
      setResults([]);
      return undefined;
    }
    if (HANGUL_RE.test(keyword)) {
      setResults([]);
      return undefined;
    }
    if (!/^[A-Za-z0-9.-]{1,12}$/.test(keyword)) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await searchStocks(keyword);
        setResults(response.items || []);
        setHint('');
      } catch (err) {
        setResults([]);
        setHint(err.message || '종목 검색에 실패했습니다.');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function changeQuery(value) {
    const raw = String(value || '');
    const nextQuery = HANGUL_RE.test(raw) ? raw : raw.toUpperCase();
    setQuery(nextQuery);
    if (onClear) onClear();
    if (!nextQuery.trim()) {
      setHint('');
      return;
    }
    if (HANGUL_RE.test(nextQuery)) {
      setHint('국내 종목은 6자리 종목코드로 검색하세요 (예: 005930 → 삼성전자).');
      return;
    }
    if (/^[A-Z0-9.-]{1,12}$/.test(nextQuery)) {
      setHint('');
      onSelect({
        stockCode: nextQuery,
        stockName: '',
        symbol: nextQuery,
        name: '',
        market: inferMarket(nextQuery),
        currency: inferCurrency(inferMarket(nextQuery))
      });
    } else {
      setHint('영문/숫자/점/하이픈만 가능합니다 (최대 12자).');
    }
  }

  function selectStock(stock) {
    const symbol = stock.stockCode || stock.symbol;
    const rawName = (stock.stockName || stock.name || '').trim();
    const name = rawName && rawName !== symbol ? rawName : '';
    setQuery(formatDisplay(symbol, name));
    setResults([]);
    setHint('');
    onSelect({
      stockCode: symbol,
      stockName: name,
      symbol,
      name,
      market: stock.market,
      exchange: stock.exchange,
      currency: stock.currency
    });
  }

  return (
    <label className="stock-search-field">
      <span>{label}</span>
      <div className="stock-search">
        <input
          placeholder="예: TQQQ"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          autoComplete="off"
        />
        {results.length > 0 && (
          <div className="stock-results">
            {results.map((stock) => (
              <button
                type="button"
                key={`${stock.market}-${stock.exchange || ''}-${stock.symbol}`}
                onClick={() => selectStock(stock)}
              >
                <strong>{stock.symbol}</strong>
                <span>{stock.name}</span>
                <em>
                  {stock.market === 'KR' ? '국내' : '해외'} · {stock.currency}
                  {stock.fractionalTradingAvailable ? ' · 소수점 가능' : ''}
                </em>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="helper">
        {loading ? 'KIS에서 종목을 조회하는 중입니다.' : (hint || helper)}
      </p>
      {stockCode && (
        <p className="selected-stock">
          선택됨: <b>{stockCode}</b>{stockName && stockName !== stockCode ? ` · ${stockName}` : ''}
        </p>
      )}
    </label>
  );
}

function formatDisplay(symbol, name) {
  const sym = String(symbol || '').trim();
  const nm = String(name || '').trim();
  if (!sym) return '';
  if (!nm || nm === sym) return sym;
  return `${sym} · ${nm}`;
}

const HANGUL_RE = /[가-힣ᄀ-ᇿ㄰-㆏]/;

function inferMarket(symbol) {
  return /^\d{6}$/.test(String(symbol || '')) ? 'KR' : 'US';
}

function inferCurrency(market) {
  return market === 'KR' ? 'KRW' : 'USD';
}
