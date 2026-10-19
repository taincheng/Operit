#!/usr/bin/env python3
"""把采集包的工作流模板转成可直接推到设备的正式工作流 JSON。

为什么需要它：模板导入（工作流页 → 从模板新建 → 插件模板）要手点界面，而采集期间不能动手机。
真机验证时改为等价路径：按模板资源生成正式工作流文件，直接写进宿主的工作流目录
（宿主的导入逻辑本来也就是「按模板生成一个新的 workflow id 再写入该目录」）。

用法：
    python3 build_workflow_from_template.py <模板 json> <workflow uuid> <输出 json>
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__)
        return 2

    template_path = Path(sys.argv[1])
    workflow_id = sys.argv[2]
    output_path = Path(sys.argv[3])

    workflow = json.loads(template_path.read_text(encoding="utf-8"))
    now_ms = int(time.time() * 1000)

    workflow["id"] = workflow_id
    workflow["name"] = f"{workflow['name']}（连续采集测试）"
    workflow["createdAt"] = now_ms
    workflow["updatedAt"] = now_ms
    workflow["enabled"] = True
    workflow["lastExecutionTime"] = None
    workflow["lastExecutionStatus"] = None
    workflow["totalExecutions"] = 0
    workflow["successfulExecutions"] = 0
    workflow["failedExecutions"] = 0

    output_path.write_text(
        json.dumps(workflow, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"written {output_path} id={workflow_id} name={workflow['name']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
