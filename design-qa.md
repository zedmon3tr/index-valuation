# Design QA

- source visual truth path: `/Users/zzz/Documents/Claude/Financing/0.png`
- implementation screenshot path: `/Users/zzz/Documents/Claude/Financing/qa-implementation.png`
- responsive screenshot path: `/Users/zzz/Documents/Claude/Financing/qa-mobile.png`
- full-view comparison evidence: `/Users/zzz/Documents/Claude/Financing/qa-comparison-full.png`
- focused controls comparison: `/Users/zzz/Documents/Claude/Financing/qa-comparison-controls.png`
- focused chart comparison: `/Users/zzz/Documents/Claude/Financing/qa-comparison-chart.png`
- viewport: 2322 x 1062 desktop; 390 x 844 responsive check
- state: 沪深300详情页，股息率，10年筛选（实际有效覆盖 2026-05-18 至 2026-06-12），分位线开启

## Findings

- No actionable P0/P1/P2 findings remain.
- [P3] The implementation keeps a compact global brand/search header that is not present in the reference. This is an intentional product navigation difference; the analysis toolbar, instrument strip, statistics pane, and chart retain the reference hierarchy below it.
- [P3] The reference shows additional metrics and adjustment markers that are unavailable from the project's verified data sources. The implementation exposes only metrics backed by real series and adds period, moving-average, quantile, standard-deviation, custom-range, and table controls instead of displaying inert options.

## Fidelity Surfaces

- Fonts and typography: system Chinese UI stack, weight hierarchy, numeric alignment, small metadata, and dense control labels are consistent with the reference's utilitarian finance interface.
- Spacing and layout rhythm: the desktop workspace now uses the full wide viewport, with a roughly 19/81 statistics-to-chart split, compact segmented controls, and a dense two-row toolbar. The mobile breakpoint has no document-level horizontal overflow.
- Colors and visual tokens: white/gray analytical surfaces, teal active controls, cyan valuation area, blue index line, and semantic red/gray/green reference lines match the source direction.
- Image quality and asset fidelity: the target contains no required product imagery. Charts are rendered natively at the target viewport and remain sharp.
- Copy and content: labels are localized and data-specific. Coverage, sample count, source, percentile, and higher-is-better dividend semantics are explicit.

## Interaction Evidence

- 股息率按钮 renders and switches the active metric.
- 沪深300 shows 20 valid D/P2 samples and its exact coverage window.
- 恒生指数 exposes monthly PE and dividend-yield history.
- Custom dates, weekly period, MA20, standard-deviation overlay, and detail-table view all change state successfully.
- Dividend yield reverses the PE/PB valuation semantics: 30th percentile is danger and 70th percentile is opportunity.

## Patches Made Since Previous QA Pass

- Expanded the desktop container from 1440px to a 2320px workbench.
- Changed the statistics pane to a responsive 19% wide column.
- Corrected dividend-yield danger/opportunity thresholds, chart colors, and percentile gradient.
- Added cache-version bumps for the updated CSS and JavaScript.

## Follow-up Polish

- Add more metric tabs only when stable historical sources for PS, PCF, or a defensible risk-premium series are available.
- Add adjustment markers only when a reliable event source is introduced.

final result: passed
