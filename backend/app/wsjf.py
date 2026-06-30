from app.models import Item


def recompute(item: Item) -> None:
    bv, tc, rr = item.business_value, item.time_criticality, item.risk_reduction
    if bv is None or tc is None or rr is None:
        return
    cod = bv + tc + rr
    item.cost_of_delay = cod
    if item.job_size:
        item.wsjf_score = cod / item.job_size
    else:
        item.wsjf_score = None
