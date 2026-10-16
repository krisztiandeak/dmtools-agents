/**
 * Unit tests: scm.js GitLab provider — submitReview mapping.
 *
 * GitLab has no REQUEST_CHANGES review event. The provider-native mapping:
 *   APPROVE          -> gitlab_approve_mr
 *   REQUEST_CHANGES  -> gitlab_unapprove_mr + explanation comment
 *   COMMENT          -> plain MR comment (approval state untouched)
 */
/* global loadModule, assert, test, suite */

suite('scm gitlab submitReview', function () {

    function loadGitlabScm(mocks) {
        var mod = loadModule('js/common/scm.js',
            makeRequire({ './machineNotice.js': loadModule('js/common/machineNotice.js') }),
            mocks || {});
        return mod.createScm({ scm: { provider: 'gitlab' }, repository: { owner: 'mygroup', repo: 'my-repo' } });
    }

    test('APPROVE maps to gitlab_approve_mr with the MR id', function () {
        var calls = [];
        var scm = loadGitlabScm({
            gitlab_approve_mr: function (args) { calls.push({ tool: 'approve', args: args }); return { success: true }; }
        });
        scm.submitReview(42, 'APPROVE', 'Looks good.');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].tool, 'approve');
        assert.equal(calls[0].args.pullRequestId, '42');
        assert.equal(calls[0].args.workspace, 'mygroup');
        assert.equal(calls[0].args.repository, 'my-repo');
    });

    test('REQUEST_CHANGES revokes the approval and posts the explanation comment', function () {
        var calls = [];
        var scm = loadGitlabScm({
            gitlab_unapprove_mr: function (args) { calls.push({ tool: 'unapprove', args: args }); return { success: true }; },
            gitlab_add_mr_comment: function (args) { calls.push({ tool: 'comment', args: args }); return { success: true }; }
        });
        scm.submitReview(42, 'REQUEST_CHANGES', 'Blocking issue in module X.');
        assert.equal(calls.length, 2);
        assert.equal(calls[0].tool, 'unapprove');
        assert.equal(calls[1].tool, 'comment');
        assert.equal(calls[1].args.text, 'Blocking issue in module X.');
    });

    test('REQUEST_CHANGES without a body falls back to a default explanation', function () {
        var calls = [];
        var scm = loadGitlabScm({
            gitlab_unapprove_mr: function () { return { success: true }; },
            gitlab_add_mr_comment: function (args) { calls.push(args); return { success: true }; }
        });
        scm.submitReview(42, 'REQUEST_CHANGES', '');
        assert.equal(calls.length, 1);
        assert.ok(String(calls[0].text).length > 0, 'default explanation must be non-empty');
    });

    test('COMMENT posts a plain MR comment and never touches approvals', function () {
        var calls = [];
        var scm = loadGitlabScm({
            gitlab_add_mr_comment: function (args) { calls.push(args); return { success: true }; },
            gitlab_approve_mr: function () { throw new Error('must not approve on COMMENT'); },
            gitlab_unapprove_mr: function () { throw new Error('must not unapprove on COMMENT'); }
        });
        scm.submitReview(42, 'COMMENT', 'FYI note.');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].text, 'FYI note.');
    });

    test('fetchDiscussions keeps only resolvable review threads (no system or plain notes)', function () {
        var scm = loadGitlabScm({
            gitlab_get_mr_discussions: function () {
                return [
                    { id: 'd1', individual_note: true, notes: [{ system: true, body: 'added 1 commit' }] },
                    { id: 'd2', individual_note: true, notes: [{ system: false, body: '## Automated Code Review' }] },
                    { id: 'd3', individual_note: false, resolved: false,
                      notes: [{ system: false, body: 'Handle the error', position: { new_path: 'src/a.rs', new_line: 7 } }] },
                    { id: 'd4', individual_note: false, resolved: true,
                      notes: [{ system: false, body: 'Done already', position: { new_path: 'src/b.rs', new_line: 2 } }] }
                ];
            }
        });
        var threads = scm.fetchDiscussions(8).rawThreads.threads;
        assert.equal(threads.length, 2);
        assert.equal(threads[0].threadId, 'd3');
        assert.equal(threads[0].resolved, false);
        assert.equal(threads[1].threadId, 'd4');
        assert.equal(threads[1].resolved, true);
    });
});
