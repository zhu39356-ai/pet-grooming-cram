# 寵物美容丙級＋寵物急救刷題 PWA v13.0

## v13.0 啟動修正

- 移除 app.js 的 ES Module 頂層 import，避免手機瀏覽器因模組載入失敗而整支程式完全不執行。
- SOURCES 設定已直接內建到 app.js，不再依賴 data/sources.js 才能啟動。
- app.js 改為一般 defer script，提升 Samsung Internet / Android WebView 相容性。
- 更新 Service Worker 快取版本，避免舊版 JS 持續被快取。
- 題庫、錯題、排除題與學習紀錄邏輯維持不變。
