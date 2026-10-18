from flask import Flask, request, render_template_string

app = Flask(__name__)

bins = [
    {"id": "BIN-07", "fill": 95},
    {"id": "BIN-08", "fill": 70},
    {"id": "BIN-09", "fill": 35},
]


def priority(fill):
    return min(100, max(0, fill))


def overflow_hours(fill):
    # Demo estimate: assume 5 percentage points per hour.
    return round((100 - fill) / 5, 1)


PAGE = """
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CityPulseAI | Smart Waste Dashboard</title>
<style>
* { box-sizing: border-box; }
body {
    margin: 0; font-family: Arial, sans-serif;
    background: #0b1220; color: #edf2f7;
}
header { padding: 28px 6%; background: #111c2e; }
header h1 { margin: 0; color: #62e6a7; }
header p { color: #a9b8cb; margin-bottom: 0; }
main { max-width: 1100px; margin: auto; padding: 28px 20px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 16px; }
.card {
    background: #152238; padding: 22px; border-radius: 14px;
    border: 1px solid #293a52; margin-bottom: 16px;
}
.number { font-size: 30px; font-weight: bold; color: #62e6a7; }
.muted { color: #a9b8cb; }
.bins { display: grid; grid-template-columns: repeat(auto-fit,minmax(230px,1fr)); gap: 16px; margin-top: 20px; }
.bar { height: 9px; background: #304159; border-radius: 8px; overflow: hidden; }
.fill { height: 100%; background: #62e6a7; }
.high { color: #ff8585; }
label { display: block; margin: 12px 0 6px; }
input, select, button {
    padding: 11px; border-radius: 8px; border: 1px solid #40536c;
    font-size: 15px; width: 100%;
}
input, select { background: #0b1220; color: white; }
button { margin-top: 16px; background: #62e6a7; color: #0b1220; font-weight: bold; cursor: pointer; }
.notice { color: #a9b8cb; font-size: 13px; line-height: 1.5; }
</style>
</head>
<body>
<header>
    <h1>🌿 CityPulseAI</h1>
    <p>Smart Urban Waste Management · Live Demo Dashboard</p>
</header>
<main>
    <section class="stats">
        <div class="card"><div class="muted">Bins monitored</div><div class="number">{{ bins|length }}</div></div>
        <div class="card"><div class="muted">Average fill level</div><div class="number">{{ average }}%</div></div>
        <div class="card"><div class="muted">High-priority bins</div><div class="number">{{ high_count }}</div></div>
    </section>

    <h2>Bin monitoring</h2>
    <section class="bins">
    {% for b in bins %}
        <div class="card">
            <h3>{{ b.id }}</h3>
            <div class="number">{{ b.fill }}%</div>
            <div class="bar"><div class="fill" style="width:{{ b.fill }}%"></div></div>
            <p class="{{ 'high' if b.fill >= 80 else 'muted' }}">
                {{ 'High priority' if b.fill >= 80 else 'Normal priority' }}
            </p>
            <p class="muted">Priority score: {{ b.priority }}/100</p>
            <p class="muted">Estimated time to full: {{ b.hours }} hours</p>
        </div>
    {% endfor %}
    </section>

    <section class="card">
        <h2>Update bin observation</h2>
        <form method="post" action="/update">
            <label for="bin_id">Choose bin</label>
            <select id="bin_id" name="bin_id">
            {% for b in bins %}
                <option value="{{ b.id }}">{{ b.id }}</option>
            {% endfor %}
            </select>
            <label for="fill">Observed fill level (0–100%)</label>
            <input id="fill" name="fill" type="number" min="0" max="100" required>
            <button type="submit">Update bin status</button>
        </form>
        {% if message %}<p>{{ message }}</p>{% endif %}
    </section>

    <section class="card">
        <h2>Collection recommendation</h2>
        <p>{{ recommendation }}</p>
        <p class="notice">Demo only: fill levels are entered manually. Overflow times use an assumed rate of 5 percentage points per hour, not live sensor data. This demo does not perform automatic visual fill detection.</p>
    </section>
</main>
</body>
</html>
"""


@app.route("/", methods=["GET"])
def dashboard():
    ordered = sorted(bins, key=lambda b: b["fill"], reverse=True)
    for b in ordered:
        b["priority"] = priority(b["fill"])
        b["hours"] = overflow_hours(b["fill"])

    average = round(sum(b["fill"] for b in bins) / len(bins))
    high_count = sum(b["fill"] >= 80 for b in bins)
    recommendation = (
        f"Assess {ordered[0]['id']} first; it has the highest fill level "
        f"at {ordered[0]['fill']}%."
    ) if ordered else "No bins available."

    return render_template_string(
        PAGE, bins=ordered, average=average,
        high_count=high_count, recommendation=recommendation,
        message=request.args.get("message", "")
    )


@app.route("/update", methods=["POST"])
def update():
    bin_id = request.form.get("bin_id", "")
    try:
        fill = int(request.form.get("fill", ""))
    except ValueError:
        return "Please enter a whole-number fill level.", 400

    if not 0 <= fill <= 100:
        return "Fill level must be between 0 and 100.", 400

    for b in bins:
        if b["id"] == bin_id:
            b["fill"] = fill
            return __import__("flask").redirect(
                "/?message=" + f"{bin_id} updated to {fill}%25"
            )

    return "Bin not found.", 404


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)