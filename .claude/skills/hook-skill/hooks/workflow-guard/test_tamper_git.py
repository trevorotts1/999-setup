"""Tamper detection and git: a git-only state-changing command (merge, checkout, rebase ...) that leaves a protected file byte-identical to HEAD (or
absent from HEAD, when deleted) is repository state, not a forgery. Anything else stays a TAMPER."""
import subprocess
import pytest
from test_tamper import env, bash, next_call, alerts  # noqa: F401


def _git(env, *a):
    subprocess.run(['git', '-C', str(env.proj), '-c', 'user.email=t@t', '-c', 'user.name=t', *a], check=True, capture_output=True)


@pytest.fixture
def repo(env):
    _git(env, 'init', '-q'); _git(env, 'add', '-A'); _git(env, 'commit', '-q', '-m', 'base')
    env.committed = env.plan.read_text()
    return env


def test_git_checkout_restoring_committed_bytes_is_not_tamper(repo):
    repo.plan.write_text(repo.committed + '\n')  # a local edit made earlier
    bash(repo, 'git -c user.email=t@t -c user.name=t stash', 'G1')  # really runs: the file returns to the committed bytes
    assert repo.plan.read_text() == repo.committed
    assert next_call(repo, 'G2')[0] == 0
    assert alerts(repo) == [], alerts(repo)


def test_git_only_command_but_file_differs_from_head_is_tamper(repo):
    bash(repo, 'git stash list', 'G3', run=False)
    repo.plan.write_text(repo.committed + '\n\n')  # changed by something else while a git-only call was in flight
    next_call(repo, 'G4')
    assert len(alerts(repo)) == 1


def test_non_state_changing_git_command_gets_no_exemption(repo):
    bash(repo, 'git status --short', 'G5', run=False)
    repo.plan.write_text(repo.committed)  # identical to HEAD, but `status` changes nothing: not explained by git
    (repo.proj / 'BM-SWARM-PLAN.json').write_text('{}')
    next_call(repo, 'G6')
    assert [c for c, *_ in alerts(repo)] == ['created']
