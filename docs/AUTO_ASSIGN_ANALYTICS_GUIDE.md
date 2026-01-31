# Auto-Assign Analytics Guide

This guide explains how to interpret the Firebase Analytics data collected for the auto-assign feature to draw actionable conclusions about user satisfaction and feature effectiveness.

## Events Overview

| Event | Description | When Fired |
|-------|-------------|------------|
| `auto_assign_court` | Single court auto-assign clicked | Each time user clicks "Auto" on a court |
| `auto_assign_all_courts` | Bulk auto-assign clicked | When user clicks "Auto-assign all" |
| `auto_assign_next` | Queue auto-assign clicked | When organizing next game while current is in progress |
| `auto_assign_manual_adjustment` | User manually changes pairs | After auto-assign, when user swaps players |
| `auto_assign_cleared` | User clears court after auto-assign | When user clicks "Clear" after using auto-assign |
| `auto_assign_config_changed` | User changes auto-assign settings | When priority/gender/blacklist settings change |
| `game_started` | Game begins on a court | Contains full auto-assign journey data |
| `session_ended_auto_assign_summary` | Session ends | Aggregated session-level metrics |

---

## Key Metrics & How to Interpret Them

### 1. Auto-Assign Clicks Before Game Start

**Parameter:** `auto_assign_clicks_before_start` (in `game_started` event)

| Value | Interpretation | Action |
|-------|---------------|--------|
| **0** | Manual assignment - user didn't use auto-assign | Feature adoption issue |
| **1** | Perfect! User happy with first suggestion | Algorithm is working well |
| **2** | Acceptable - minor adjustment needed | Normal behavior |
| **3+** | User struggling to get acceptable matchup | Algorithm needs improvement |
| **5+** | Significant dissatisfaction | Investigate specific constraints |

**Firebase Query:**
```
Event: game_started
Group by: auto_assign_clicks_before_start
Metric: Event count
```

**Goal:** 70%+ of games should have click count ≤ 2

---

### 2. Time from Auto-Assign to Game Start

**Parameters:** 
- `seconds_from_first_auto_assign` - Time from first click to game start
- `seconds_from_last_auto_assign` - Time from last click to game start

| Scenario | Interpretation |
|----------|---------------|
| `first` < 30s, `last` < 10s | Quick decision - user satisfied |
| `first` > 60s, `last` < 10s | Multiple rerolls, eventually found good match |
| `first` > 120s, `last` > 60s | Significant struggle or distraction |

**What to Look For:**
- If `seconds_from_last_auto_assign` is consistently low (< 10s), users accept assignments quickly
- If `seconds_from_first_auto_assign` >> `seconds_from_last_auto_assign`, users are rerolling multiple times

---

### 3. Manual Adjustments After Auto-Assign

**Parameter:** `manual_adjustments_after_auto_assign` (in `game_started` event)

This tracks when users accept the auto-assign players but swap the team pairings.

| Value | Interpretation |
|-------|---------------|
| **0** | User accepted pairs as-is - algorithm pairing is good |
| **1-2** | Minor tweaks - acceptable |
| **3+** | User significantly disagrees with pairings |

**Key Insight:** High manual adjustments + low rerolls = users like the player selection but not the pairing logic

---

### 4. Clear Rate (Dissatisfaction Signal)

**Event:** `auto_assign_cleared`

This is a **strong negative signal** - user rejected the auto-assign entirely.

**Key Parameters:**
- `auto_assign_clicks_before_clear` - How many attempts before giving up
- `was_quick_clear` - Did they clear within 10 seconds?

| Scenario | Interpretation |
|----------|---------------|
| `clicks = 1`, `was_quick_clear = true` | Instant rejection - algorithm failed badly |
| `clicks ≥ 3`, `was_quick_clear = false` | User tried, couldn't find acceptable match |
| `clicks ≥ 3`, `was_quick_clear = true` | Frustrated user spamming reroll |

**Formula: Clear Rate**
```
Clear Rate = auto_assign_cleared events / auto_assign_court events
```
**Goal:** Clear Rate < 10%

---

### 5. Configuration Changes (User Dissatisfaction)

**Event:** `auto_assign_config_changed`

When users change settings, it signals the defaults aren't working for them.

**Key Parameters:**
- `changed_fields` - What they changed
- `session_total_auto_assign_clicks` - Usage before changing

| Pattern | Interpretation |
|---------|---------------|
| Change after many clicks | User frustrated with current settings |
| Change `priority` to "variety" | Users getting repetitive matchups |
| Change `respect_gender` to "off" | Gender balancing is too restrictive |
| Change `respect_gender` to "hard" | Users want strict gender separation |

---

### 6. Session-Level Adoption Rate

**Event:** `session_ended_auto_assign_summary`

**Key Parameters:**
- `auto_assign_usage_rate` - % of games that used auto-assign
- `auto_assign_clicks_per_game` - Average clicks per game

| Metric | Target | Interpretation |
|--------|--------|---------------|
| `auto_assign_usage_rate` | > 80% | High adoption = feature is valuable |
| `auto_assign_usage_rate` | < 50% | Low adoption = feature not meeting needs |
| `auto_assign_clicks_per_game` | 1.0 - 1.5 | Ideal range |
| `auto_assign_clicks_per_game` | > 2.5 | Users rerolling too much |

---

## Building Firebase Dashboards

### Dashboard 1: Feature Adoption

**Metric Cards:**
1. **Total Auto-Assign Clicks** - `auto_assign_court` + `auto_assign_all_courts` count
2. **Games Using Auto-Assign** - `game_started` where `used_auto_assign = true`
3. **Adoption Rate** - `used_auto_assign = true` / total `game_started`

### Dashboard 2: User Satisfaction

**Charts:**
1. **Distribution of Clicks Before Start** (Histogram)
   - X: `auto_assign_clicks_before_start` (0, 1, 2, 3, 4, 5+)
   - Y: Event count

2. **Clear Rate Over Time** (Line chart)
   - Daily `auto_assign_cleared` / `auto_assign_court`

3. **Manual Adjustment Rate** (Pie chart)
   - `had_manual_adjustments = true` vs `false`

### Dashboard 3: Algorithm Performance

**Metrics by Configuration:**
- Filter by `priority` (default, variety, rest)
- Compare success rates, click counts, clear rates

---

## Specific Analysis Queries

### Query 1: What percentage of games needed multiple rerolls?

```
Event: game_started
Filter: auto_assign_clicks_before_start >= 3
Compare to: Total game_started events
```

**Healthy target:** < 15% of games need 3+ clicks

### Query 2: Are users happy with the pairing algorithm?

```
Event: game_started
Filter: used_auto_assign = true
Metric: Average of manual_adjustments_after_auto_assign
```

**Healthy target:** Average < 0.5 adjustments per game

### Query 3: Which configuration performs best?

```
Event: game_started
Group by: priority
Metric: Average of auto_assign_clicks_before_start
```

Compare averages across "default", "variety", "rest"

### Query 4: Is the algorithm improving over time?

```
Event: game_started
Time series: Daily
Metric: Average of auto_assign_clicks_before_start
```

Trend should be decreasing or stable

### Query 5: Quick abandonment rate

```
Event: auto_assign_cleared
Filter: was_quick_clear = true
Percentage of all auto_assign_cleared
```

**Healthy target:** < 30% of clears are "quick clears"

---

## Red Flags to Watch For

| Signal | What It Means | Likely Cause |
|--------|--------------|--------------|
| Clicks per game > 3 | Users struggling | Algorithm constraints too tight |
| Clear rate > 20% | High abandonment | Algorithm failing to find valid matches |
| Quick clear rate > 50% | Instant rejection | Fundamental algorithm issue |
| Manual adjustments > 2 per game | Bad pairing | Team strength calculation off |
| Config changes spike | Mass dissatisfaction | Recent change broke something |
| Adoption rate dropping | Users giving up | Feature not providing value |

---

## Success Criteria

### Overall Health Metrics

| Metric | Poor | Acceptable | Good | Excellent |
|--------|------|------------|------|-----------|
| Adoption Rate | < 50% | 50-70% | 70-85% | > 85% |
| Avg Clicks/Game | > 3.0 | 2.0-3.0 | 1.5-2.0 | 1.0-1.5 |
| Clear Rate | > 20% | 10-20% | 5-10% | < 5% |
| 1-Click Success | < 40% | 40-55% | 55-70% | > 70% |

### Formula: Auto-Assign Satisfaction Score

```
Satisfaction Score = 
  (1-click games × 100) + 
  (2-click games × 75) + 
  (3-click games × 50) + 
  (4+ click games × 25) - 
  (cleared × 50)
  ─────────────────────────
  Total auto-assign events
```

**Target:** Score > 70

---

## Action Items Based on Data

| Finding | Root Cause | Solution |
|---------|-----------|----------|
| High rerolls in doubles | Rating imbalance | Tune `closeW` weight |
| Many gender constraint failures | Not enough players | Suggest adding more players |
| Users always change to "variety" | Too many repeat matchups | Increase `partnerRepeatW` |
| High manual pair adjustments | Synergy not considered | Improve team chemistry scoring |
| Low adoption in small sessions | Not useful with few players | Show messaging for minimum players |

---

## Recommended Review Cadence

| Frequency | What to Check |
|-----------|---------------|
| **Daily** | Clear rate, error rates |
| **Weekly** | Adoption rate, avg clicks per game |
| **Monthly** | Configuration preferences, satisfaction trends |
| **Quarterly** | Overall feature health, compare to previous quarter |

---

## Notes

- All time metrics are in **seconds**
- Session-level metrics only fire when session ends normally
- Config tracking captures both old and new values for A/B comparison
- Manual adjustment tracking resets when user clicks auto-assign again
