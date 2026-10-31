"""外部服务模块示例（Python / FastAPI）。

和底座的约定（任何语言都一样）：
- GET  /health            健康检查，非 200 会被底座标记为“不可用”
- POST /_events           底座投递订阅的事件 {event, from, at, id, payload}，非 2xx 会重试，用尽进死信队列
- POST /_jobs/<name>      底座按 manifest 里的 cron 调用定时任务
- 发事件：POST {CORE_URL}/api/_core/events，头 x-module-name: py-example
- 其余路径由底座代理：/api/py-example/<path> -> 本服务 /<path>，请求头里有 x-user-id / x-user-role
- 只读写自己的 m_py_example_* 表
"""
import os
import httpx
import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse

DB_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/dashboard").split("?")[0]
CORE_URL = os.environ.get("CORE_URL", "http://localhost:4000")
app = FastAPI()


def q(sql, *params):
    with psycopg.connect(DB_URL, row_factory=dict_row, autocommit=True) as c:
        cur = c.execute(sql, params)
        return cur.fetchall() if cur.description else []


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/items")
def items():
    return q("SELECT id, title, source, created_at::text FROM m_py_example_items ORDER BY id DESC LIMIT 50")


@app.post("/items")
async def add_item(req: Request):
    body = await req.json()
    return q("INSERT INTO m_py_example_items (title) VALUES (%s) RETURNING id, title, source", body.get("title") or "untitled")[0]


@app.post("/emit")
def emit():
    r = httpx.post(f"{CORE_URL}/api/_core/events", headers={"x-module-name": "py-example", "x-module-token": os.environ.get("MODULE_TOKEN", "")},
                   json={"event": "recalc.requested", "payload": {"reason": "manual_adjust", "dateFrom": "2026-10-30", "dateTo": "2026-10-30"}}, timeout=5)
    return r.json()


@app.post("/_events")
async def on_event(req: Request):
    env = await req.json()
    q("INSERT INTO m_py_example_items (title, source) VALUES (%s, 'event')", f"收到 {env['event']}（来自 {env['from']}）")
    return {"ok": True}


@app.post("/_jobs/{name}")
def run_job(name: str):
    q("INSERT INTO m_py_example_items (title, source) VALUES (%s, 'job')", f"job {name}")
    return {"ok": True}


@app.get("/ui", response_class=HTMLResponse)
def ui():
    # 后台用 iframe(srcdoc) 显示，和看板同源，可以直接用看板的登录 token 调接口
    return """<!doctype html><meta charset=utf-8><body style="font-family:sans-serif">
<h3>Python 外部服务示例</h3>
<input id=t placeholder=标题> <button onclick=add()>新增</button> <button onclick=emit()>发事件</button>
<ul id=l></ul>
<script>
const H={authorization:'Bearer '+localStorage.getItem('dashboard_token'),'content-type':'application/json'};
async function load(){const r=await fetch('/api/py-example/items',{headers:H});const d=await r.json();
document.getElementById('l').innerHTML=d.map(x=>'<li>'+x.id+' '+x.title+' ('+x.source+')</li>').join('')}
async function add(){await fetch('/api/py-example/items',{method:'POST',headers:H,body:JSON.stringify({title:document.getElementById('t').value})});load()}
async function emit(){await fetch('/api/py-example/emit',{method:'POST',headers:H,body:'{}'});setTimeout(load,1500)}
load()
</script>"""
