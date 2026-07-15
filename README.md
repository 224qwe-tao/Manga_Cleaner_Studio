# Manga Cleaner Studio（已修正網站樣式）

這個版本已經是**完成建置的靜態網站**。根目錄的 `index.html` 會直接載入 `assets` 內的 CSS、JavaScript 和背景消除所需檔案，不會再出現只有純文字、按鈕沒有設計的情況。

## 錯誤原因

舊版本根目錄放的是 Vite 開發原始碼：

- CSS 由 `src/main.js` 內的 `import './style.css'` 載入
- `index.html` 指向 `/src/main.js`
- 這些檔案必須先執行 `npm run build`

當 GitHub Pages 使用「Deploy from a branch」直接發布原始碼時，瀏覽器無法按 Vite 的方式處理 CSS 與 npm 套件，因此頁面只顯示未套用樣式的 HTML。

## 最簡單的 GitHub Pages 部署方法

1. 解壓 ZIP。
2. 將 `Manga_Cleaner_Studio_Fixed` 資料夾內的**全部檔案和資料夾**上傳到 GitHub repository 根目錄。
3. 開啟 repository 的 **Settings → Pages**。
4. 在 **Build and deployment** 選擇：
   - **Source：Deploy from a branch**
   - **Branch：main**
   - **Folder：/ (root)**
5. 按 **Save**，等待 GitHub Pages 完成發布。

根目錄已包含 `.nojekyll`，GitHub Pages 會原樣發布所有網站資源。

## 也可以使用 GitHub Actions

檔案內已附上 `.github/workflows/deploy-pages.yml`。如 Pages 的 Source 選擇 **GitHub Actions**，每次更新 `main` branch 時亦會自動部署。

## 檔案結構

- `index.html`：可直接發布的正式網站
- `assets/`：正式版 CSS、JavaScript、WebAssembly 等資源
- `.nojekyll`：避免 GitHub Pages 忽略網站檔案
- `.github/workflows/`：GitHub Actions 部署設定
- `source-code/`：供日後修改功能的 Vite 原始碼；網站運行不依賴此資料夾

## 修改原始碼後重新建立正式版

進入 `source-code`：

```bash
npm install
npm run build
```

然後以新產生的 `source-code/dist/index.html` 和 `source-code/dist/assets/` 取代根目錄的 `index.html` 和 `assets/`。

## 注意

- 請不要只上傳 `source-code` 資料夾作為 GitHub Pages 網站。
- 首次使用背景消除時，瀏覽器仍可能需要載入模型，所需時間視網絡和電腦效能而定。
- 漫畫圖片的主要處理在瀏覽器本機進行。
