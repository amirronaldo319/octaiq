# Fighter stats file

Copy `fighters.example.csv` to `fighters.csv` and fill it with real data. The server re-reads it on every odds refresh.
Fighter names must match the names in the odds feed (accents, case, punctuation and word order are ignored).

| Column | Required | Notes |
|---|---|---|
| name | yes | |
| slpm | yes | Significant strikes landed per minute |
| str_acc | yes | Strike accuracy; `0.48`, `48` or `48%` |
| str_def | yes | Strike defense |
| td_avg | yes | Takedowns landed per 15 minutes |
| td_def | yes | Takedown defense |
| record | no | e.g. `15-3-0` |
| age or dob | no | `dob` as `YYYY-MM-DD`; default age 30 |
| reach_cm | no | default 180 |
| sub_avg | no | Submission attempts per 15 min; default 0.3 |
| finish_rate | no | Share of wins by finish, 0-1; default 0.5 |
| chin | no | Durability 0-1; default 0.65 (your own estimate) |
| cardio | no | 0-1; default 0.75 (your own estimate) |
| days_since_last_fight or last_fight_date | no | default 300 days |
| style | no | Striker, Wrestler, Grappler, Pressure or Counter; inferred when blank |

`fighters.csv` and `odds-history.json` are git-ignored.

## Where the stats come from

Set `UFCALENDAR_API_KEY` to fetch them from the UFCalendar API automatically (see the project README). This CSV is optional and wins over the API
for any fighter it lists, so use it for corrections and for fields the API cannot supply, such as `cardio`.

UFCStats.com has no public API and sits behind a JavaScript bot check, so this project does not scrape it.
