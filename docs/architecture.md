# Phase 1 設計と開発段階

## 実装前の整理（8項目）

1. **構成**：React/TypeScript/Vite → Workers JSON API → D1。共通の型と純粋関数をUI/Workerで共有。PagesとWorkersは別デプロイし、本番のAPI URLと許可Originを明示する。
2. **API**：Forecast API、Single Runs API、Previous Runs API。タイムゾーンUTC・Unix時刻・気温℃・降水mm・風m/sを固定。API取得はproviderインターフェースに集約。実測は管理者の出典付きCSVで導入し、将来公式観測APIアダプターを追加する。
3. **モデル**：`jma_gsm`、`ecmwf_ifs025`、`gfs_global`、`icon_global`。seamlessモデルの地域切替による系列の混同を避ける。モデルレジストリに変数能力を定義。APIで提供されない変数はnull、失敗したモデルは除外し通知する。
4. **DB**：locations、forecast_runs、forecasts、observations、model_scores、ensemble_forecasts。全時刻UTC ISO。runにはinitialization_time/issue_time/available_at/retrieved_at/source/methodを保存。unknownのissue_timeを初期化時刻で埋めない。各forecastのvalid_timeとlead_basisを保持。観測はobserved_at/available_at/imported_at/sourceを分離し追記型にする。
5. **精度**：地点×気象変数×リードタイム×期間×季節。連続値MAE/RMSE/Bias、風向は最短角距離、降雨0.1mm/h閾値のAccuracy/Precision/Recall/F1、確率Brier/校正ビン。7/30/90/365日を切替。データゼロを合格・高精度と表示しない。雨の標本数と常時無降雨ベースラインも表示する。
6. **統合**：30日、半減期14日の減衰誤差を変数スケールで正規化し逆誤差で重みを算出。20標本未満は均等。重みは50%均等へ縮約して極端な集中を防止（4モデルならfloor 12.5%、ceiling 62.5%）。利用可能なモデル間で合計1。円周平均・カテゴリ投票を別処理。
7. **MVP**：第1段階＝現在予報取得/比較/単純平均/デモ/モバイル画面。第2段階＝D1保存/Single・Previous Runs取り込み/観測CSV/指標。第3段階＝重み付き統合/共通標本の時系列ベースライン/信頼度/PWA/Cloudflare構成/テスト。各段階で動作確認する。
8. **Phase 2**：気象庁一般予報、tenki.jp、Yahoo!天気、ウェザーニュースはPhase 1から分離。公式APIと利用目的・保存・再配布・過去予報条件を調査してから追加する。現状は実装しない。

## ディレクトリ

- `src/domain`：時刻、評価、重み、統合、バックテスト（ネットワークなし）。
- `src/providers`：モデル能力とOpen-Meteoの正規化・エラー分離。
- `src/server` / `worker`：D1永続化、取得、履歴、管理API、Cron。
- `src/components`：日本語モバイルUI。
- `migrations`：D1 schema。`tests`：ドメイン/パーサ/Worker/UI検証。

## データリークを防ぐ境界

Forecast APIは最新runをつないだ系列で、発表時刻は返さない。immutableな取得スナップショットとして保存し、`available_at`を取得完了時刻、`issue_time`をnullにする。予報対象が取得時刻より未来のものだけが運用バックテスト候補。

Single Runsの`run`は初期化時刻で、公開時刻ではない。初期化基準の単独モデル診断は可能だが、遡及取得時に「当時利用できた」と推定しない。Previous Runsは固定オフセットのみ、単一runのissue timeは不明。両者をスナップショットと混ぜた実運用バックテストはしない。

予報時点の重みには、対象時刻が過去かつ観測の利用可能時刻と予報の取得時刻が予報生成時点以前の標本のみを使用する。過去の統合は変更しない。バックテストは各予報cutoffで再学習し、共通の有効時刻・モデル・実測上で単独/均等/重み付きを比較する。学習期間と評価期間、除外数、雨標本、対象runを記録する。十分な運用履歴がなければ「検証待ち」。

## 続く開発

公式観測APIの接続と公開時刻証跡の取得、自動取り込みの運用、長期の実測検証が必要。観測APIが未接続なので、Phase 1の実世界の精度向上はまだ立証していない。MLはこの追記型学習データを将来使うが、MVPでは導入しない。
