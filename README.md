# Manga Cleaner Studio

一個可部署到 GitHub Pages 的瀏覽器漫畫圖片編輯工具，用於：

- 塗抹或框選漫畫原文，透過 OpenCV Inpainting 修補背景
- 對白框純色填補
- 自動移除圖片背景
- 加入可拖動的橫排／直排譯文
- 設定字體、字號、行距、字距、描邊及對齊
- 復原／重做、縮放、全螢幕及 PNG／JPG／WEBP 匯出

圖片主要在瀏覽器本機處理，不會由本專案主動上傳至伺服器。OpenCV.js 及背景消除模型會在首次使用相關功能時由外部來源下載。

## 本機啟動

需要 Node.js 20.19 或以上版本。

```bash
npm install
npm run dev
```

瀏覽器打開終端顯示的本機網址。

## 建立正式版本

```bash
npm run build
npm run preview
```

輸出檔案位於 `dist`。

## 部署到 GitHub Pages

1. 建立新的 GitHub repository，將本資料夾全部檔案上傳。
2. 進入 repository 的 **Settings → Pages**。
3. 在 **Build and deployment → Source** 選擇 **GitHub Actions**。
4. Push 到 `main` branch 後，`.github/workflows/deploy-pages.yml` 會自動建立及部署網站。
5. 完成後，可在 Pages 頁面取得網址。

## 使用方法

1. 上傳或拖入漫畫圖片。
2. 使用「塗抹」或「框選」覆蓋原文。
3. 對白框為白色時可按「填成白色」；背景較複雜時按「智慧修補所選原文」。
4. 在右側輸入譯文，按「新增文字」，再拖到對白框內。
5. 調整橫排／直排、字體、字號、描邊及框寬。
6. 選擇輸出格式並下載成品。

## 注意事項

- 傳統 Inpainting 適合處理對白框、網點或較簡單紋理。原文直接覆蓋角色、複雜線稿或大面積背景時，結果可能需要多次小範圍處理。
- 背景消除首次執行需下載模型，速度取決於網絡及電腦效能。
- GitHub Pages 無法設定 `Cross-Origin-Opener-Policy` 與 `Cross-Origin-Embedder-Policy` 回應標頭，因此背景消除可以使用，但未必能取得最高的多執行緒效能。
- `@imgly/background-removal` 採用 AGPL-3.0 授權，本專案亦以 AGPL-3.0 發布。

## 第三方技術

- OpenCV.js：原文區域 Inpainting 修補
- `@imgly/background-removal`：瀏覽器本機背景分割與透明化
- Canvas 2D API：遮罩、文字排版及輸出
