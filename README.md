# 寵物美容丙級＋寵物急救刷題 PWA v13.2

## v13.0 啟動修正

- 移除 app.js 的 ES Module 頂層 import，避免手機瀏覽器因模組載入失敗而整支程式完全不執行。
- SOURCES 設定已直接內建到 app.js，不再依賴 data/sources.js 才能啟動。
- app.js 改為一般 defer script，提升 Samsung Internet / Android WebView 相容性。
- 更新 Service Worker 快取版本，避免舊版 JS 持續被快取。
- 題庫、錯題、排除題與學習紀錄邏輯維持不變。


## v13.2 急救題庫 404 修正
- 80 題寵物急救練習題直接內建於 app.js，首頁啟動不再依賴 data/firstaid-practice.json。
- 即使 GitHub Pages 的 data 資料夾未同步，急救每日作業仍可載入。
- Service Worker 不再把急救 JSON 當作安裝必要檔案。


## v13.2 強制避開舊快取
- 主程式改名為 `app-v13.2.js`，不再沿用 `app.js`，避免舊 Service Worker / 瀏覽器快取載入 v13.0。
- `index.html` 直接載入 `app-v13.2.js?v=13.2`。
