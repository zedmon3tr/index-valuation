"""Pure helpers for assembling generated valuation JSON."""


def merge_series(series_by_metric):
    """Align independently dated metric series on a sorted union of dates."""
    metric_maps = {}
    all_dates = set()
    for metric, pair in series_by_metric.items():
        dates, values = pair
        values_by_date = {}
        for date, value in zip(dates or [], values or []):
            if date:
                values_by_date[str(date)[:10]] = value
        if values_by_date:
            metric_maps[metric] = values_by_date
            all_dates.update(values_by_date)

    dates = sorted(all_dates)
    result = {"dates": dates}
    for metric, values_by_date in metric_maps.items():
        result[metric] = [values_by_date.get(date) for date in dates]
    return result
