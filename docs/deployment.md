# Cloudflare Pages / Workers / D1

## 開発環境

Node 24.5以降。`npm ci`、`npm run db:migrate`、`npm run setup:dev`を実行し、別々のターミナルで`npm run dev:api`と`npm run dev`を起動する。通常のNodeパッケージキャッシュに書けない環境では`npm ci --cache /tmp/weather-npm-cache`を使用する。

クラウドの環境プロキシに対応するため、開発APIはNodeの`--use-env-proxy`を使い、同じWorkerハンドラーを呼び出す。D1はWrangler公式`getPlatformProxy`のローカルエミュレーターに接続し`.wrangler/state/v3`に永続化する。プロキシ・CAを継承しTLS検証を無効にしない。通常のWorker runtimeでの確認には`npm run dev:api:worker`（このクラウドでは外部fetchは失敗する）。本番はWorker runtimeで通常のfetchを使う。

書き込み権限の限られた環境ではCLIに`WRANGLER_LOG_PATH=/tmp/weather-wrangler/logs XDG_CONFIG_HOME=/tmp/weather-wrangler/config`を渡す。この設定はアプリのSecretではない。

`npm run setup:dev`は未作成の場合に限って`.dev.vars`へ強いランダムな`ADMIN_TOKEN`を保存する（0600、値はログに出さない）。公開用のSecretとは別。`.dev.vars.example`は名前だけなので値を入れてから利用する。既存ファイルは上書きしない。商用APIの契約が必要な場合のみ`OPEN_METEO_API_KEY`を設定する。ソース・Git・チャットにキーを記載しない。

外部ドメイン：`api.open-meteo.com`、`single-runs-api.open-meteo.com`、`previous-runs-api.open-meteo.com`、文書用`open-meteo.com`、観測用`www.ncei.noaa.gov`。商用のcustomer endpointを使う場合はそれぞれの`customer-`ドメインも環境ネットワークに追加する。

## 公開手順

ここでは設定を用意しただけで、アカウントへの公開は実行していない。

1. 自分のCloudflareアカウントでWrangler認証を設定する。
2. `npx wrangler d1 create weather-forecast`。返されたdatabase_idを`wrangler.jsonc`に設定する。全ゼロIDはローカル開発用のプレースホルダー。
3. `npm run db:migrate:remote`。本番Secretを`npx wrangler secret put ADMIN_TOKEN`で登録する。商用Open-Meteo契約なら`OPEN_METEO_MODE=commercial`と`OPEN_METEO_API_KEY` Secretを設定する。
4. 実際のPagesのHTTPS Originを`ALLOWED_ORIGIN`へ設定し、`npm run deploy:api`。データ管理APIはBearerトークンで保護し、CORSはこのOriginだけに限定する。
5. `.env`またはPagesのビルド環境変数に`VITE_API_BASE=https://<実際のWorkerホスト>`を指定し、`npm run deploy:web`。Pagesのビルドコマンドは`npm run build`、出力は`dist`。APIキーをVITE_変数に入れない。
6. 公開先の`/api/health`、東京の現在予報、過去run取り込み、観測取り込みと空／非空の精度画面を検証する。本番でのPWA登録・オフライン表示を確認する。

Cronは6時間ごとの15分に設定済み。`COLLECT_LOCATION_IDS`に東京など既存地点IDをカンマ区切りで設定する。現在のCronは予報を取得し、観測の自動ポーリングは行わない。実測は管理画面から取り込む。ローカルではCronは自動実行されず`npm run collect`で試せる。

## 運用上の範囲

公開前にAPI利用目的（非商用/商用）と提供元の現在の規約を確認する。地点数・取得頻度・変数数に応じたAPI上限、Workers CPU/D1容量・クエリ上限を見積もる。長い履歴と365日評価ではWorkers有料枠のCPU時間が必要な場合がある。

履歴は追記型で、MVPでは自動削除しない。1回の観測CSVは1000行、過去予報/NOAAは31日、評価クエリは4万行を超えたら期間短縮を求め、黙って打ち切った数値を返さない。定期取得の重複防止、容量監視、バックアップ、管理トークンのローテーション、追加のアクセス制限は本番運用で整備する。

GitHub CIはテスト・ビルド・ブラウザUIの確認だけで、自動公開やSecretの書き込みをしない。公開アカウント、DNS、課金などはこのリポジトリから勝手に作成しない。

ブラウザテストはシステムChromium（この環境では/usr/bin/chromium）を使用する。なければ`npx playwright install chromium`を実行する。独自の場所のブラウザは`CHROMIUM_PATH`で指定できる。PWAテストは`npm run build`の後に`npm run test:pwa`。
