# APIと利用条件（2026-10-12調査）

最初はOpen-MeteoへのHTTPS接続が403で制限されていたが、設定反映後に東京の4モデルの現在予報・2026-10-10 00 UTCのSingle Runs・10日分のPrevious Runsを実取得できた。公式Webサイトの公開GitHubソース `open-meteo/open-meteo-website` のcommit `1755598c7ac9cf56db13d540f43b73ba97207219` と、公式API実装 `open-meteo/open-meteo` を照合した。公式Webのterms/licence/pricing/Single RunsのページのGETは403が返ったため、規約の確認根拠は公式GitHubの公開ソース。取得成功は現時点の確認であり、契約可否や継続可用性を保証しない。

| 用途 | 公式API/文書 | 用途上の注意 |
|---|---|---|
| 現在・未来予報 | https://open-meteo.com/en/docs | `models`を明示、未提供の変数はnull、最大7日を要求するがモデルのhorizonが短ければ欠測 |
| 初期化時刻ごとの過去run | https://open-meteo.com/en/docs/single-runs-api | `run=YYYY-MM-DDTHH:mm` UTC。原則2026-04-02以降。初期化は公開時刻ではなく、公開には数時間の遅延がある |
| 過去の固定リード系列 | https://open-meteo.com/en/docs/previous-runs-api | `_previous_day1`〜`7`、24〜168hのオフセット。正確なissue/run特定や1/3/6/12h評価の代替にしない |
| 利用規約 | https://open-meteo.com/en/terms | 無料API非商用、1日10,000/1時間5,000/1分600未満。変数数や期間による課金単位も確認 |
| データライセンス | https://open-meteo.com/en/licence | CC BY 4.0、出典・加工の表示。データライセンスとAPI無料枠の商用制限は別 |

無料枠を既定にする。商用利用は契約を確認し`OPEN_METEO_MODE=commercial`とWorker Secret `OPEN_METEO_API_KEY`を設定する。customer prefixの公式endpointを使う。キーをUIやURLログに出さない。永続化は予報・実測の正規化した値と出典のみで、APIキーは含めない。

降水確率は全決定論モデルで提供されるわけではない。JMA/ECMWFでは要求しない。GFSではOpen-Meteoの確率系列を取得し、アンサンブル由来であることを表示する。ICONの確率はMVPでは未提供扱い。CAPEもモデル能力に応じて取得し、雷雨確率とは表示しない。

## Phase 2調査状況

Phase 1の実データ検証が未完了のため実装・サービス固有のAPI利用条件の確定を保留。以下は候補台帳であり、利用許可の結論ではない。

| サービス | 公式API | 商用/保存/再配布/過去予報 | 実装 |
|---|---|---|---|
| 気象庁の一般向け予報 | 公開JSON候補あり、公式仕様・運用条件の確認待ち | 全項目確認待ち | 未接続 |
| tenki.jp | 未調査 | 全項目確認待ち | 未接続 |
| Yahoo!天気 | 未調査 | 全項目確認待ち | 未接続 |
| ウェザーニュース | 未調査 | 全項目確認待ち | 未接続 |

スクレイピングは実装しない。候補の確認には公式API文書URL・利用規約URL・確認日・対象プラン・保存/再配布の可否・過去予報提供の証跡を残す。

## 観測API候補

NOAA NCEI Global Hourly の公式Access Data Service API `https://www.ncei.noaa.gov/access/services/data/v1` を追加。文書 `https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation`、ISD形式 `https://www.ncei.noaa.gov/data/global-hourly/doc/isd-format-document.pdf` を参照先とする。現環境ではこのドメインへの403が残り、ライブ文書・実応答・保存/再配布条件の確認は未完了。現状のパーサはISD品質フラグ・倍率・1時間積算のみを扱うテスト済みアダプターで、実接続を検証済みとはしない。公開運用前に公式文書と適用条件を確認する。実測CSVは利用者が使用権限を持つデータを出典付きで導入する。

GFS Single Runsで確率を同時要求するとGEFS (`ncep_gefs05`) のrun未提供でHTTP 400となる実応答を確認したため、この方式では決定論GFSの変数だけを要求する。現在・Previous RunsのGFS確率とは能力を分離している。JMAの日射量も取得できない期間はnullのまま保持する。
