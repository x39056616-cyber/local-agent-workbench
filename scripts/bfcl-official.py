"""可选：在安装 bfcl-eval 的独立 Python 环境内运行官方生成器/评分器。

不替换上游评分逻辑，不修改上游文件；只在当前进程注册本地 OpenAI 兼容模型。
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'generate', 'evaluate'])
    parser.add_argument('--model', default='qwen3.8-27b-gsq-rco')
    parser.add_argument('--base-url', default='http://127.0.0.1:1234/v1')
    parser.add_argument('--category', default='simple_python')
    parser.add_argument('--ids', help='生成时必须明确指定题目 ID，逗号分隔，最多 20 题')
    parser.add_argument('--output', default='data/official-bfcl')
    args = parser.parse_args()
    if importlib.util.find_spec('bfcl_eval') is None:
        print('缺少可选依赖 bfcl-eval。请在独立 Python 3.11 环境安装官方包；当前网页本地练习不受影响。')
        return 2
    if args.action == 'doctor':
        print('已发现 bfcl_eval；实际生成、评分以及上游版本兼容性需分别验证。')
        return 0
    endpoint = urlparse(args.base_url)
    if endpoint.scheme != 'http' or endpoint.hostname not in ('127.0.0.1', 'localhost'):
        parser.error('此适配器仅允许本机 HTTP 模型服务')
    # 首版官方入口只开放单轮无外部副作用的类别；多轮/网页需使用上游隔离环境。
    if args.category not in ('simple_python', 'multiple', 'parallel', 'parallel_multiple', 'irrelevance'):
        parser.error('当前适配器只支持单轮 Python/多函数/并行/无关性类别')
    root = Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    os.environ['BFCL_PROJECT_ROOT'] = str(root)
    os.environ['OPENAI_BASE_URL'] = args.base_url
    os.environ['OPENAI_API_KEY'] = 'local-no-secret'
    from bfcl_eval.constants.model_config import ModelConfig, MODEL_CONFIG_MAPPING
    from bfcl_eval.model_handler.api_inference.openai_completion import OpenAICompletionsHandler
    from bfcl_eval.constants.supported_models import SUPPORTED_MODELS

    class LocalHandler(OpenAICompletionsHandler):
        def _build_client_kwargs(self):
            return {'base_url': args.base_url, 'api_key': 'local-no-secret', 'timeout': 180, 'max_retries': 0}

        def _query_FC(self, inference_data):
            # 保持本机 Qwen 推理设置，只限定输出长度与单请求并发。
            inference_data['inference_input_log'] = {'message': inference_data['message'], 'tools': inference_data['tools']}
            return self.generate_with_backoff(model=self.model_name, messages=inference_data['message'],
                                              tools=inference_data['tools'], max_tokens=4096, temperature=self.temperature)

    registry = 'local-workbench-qwen-FC'
    MODEL_CONFIG_MAPPING[registry] = ModelConfig(model_name=args.model, display_name='本机 Qwen（自定义量化）',
        url='https://github.com/x39056616-cyber/local-agent-workbench', org='local', license='model-specific',
        model_handler=LocalHandler, is_fc_model=True)
    if registry not in SUPPORTED_MODELS:
        SUPPORTED_MODELS.append(registry)
    from bfcl_eval.__main__ import cli
    command = [args.action, '--model', registry, '--test-category', args.category]
    if args.action == 'generate':
        ids = [s.strip() for s in (args.ids or '').split(',') if s.strip()]
        if not 1 <= len(ids) <= 20 or any(not s.startswith(args.category + '_') for s in ids):
            parser.error('请指定当前类别下的 1–20 个 --ids；不会默认运行整个题库')
        (root / 'test_case_ids_to_generate.json').write_text(json.dumps({args.category: ids}), encoding='utf-8')
        command += ['--run-ids', '--num-threads', '1']
    else:
        command += ['--partial-eval']
    cli(args=command, prog_name='bfcl-local')
    return 0


if __name__ == '__main__':
    sys.exit(main())
