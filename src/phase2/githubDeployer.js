const { Octokit } = require('@octokit/rest');
const { generateCodeChange } = require('./codeGenerator');
const { addChangelogEntry } = require('../sheets');
const { setPending } = require('../pendingState');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;

/**
 * Step 1 (on user approval of a suggestion):
 * Generate code via Claude → push to a new branch → ask for deploy confirmation.
 */
async function deployImprovement(suggestion, whatsappClient) {
  const groupId = process.env.WHATSAPP_GROUP_ID;
  const timestamp = new Date().toISOString();

  try {
    await whatsappClient.sendMessage(groupId, '⚙️ מייצר את השינוי, רגע...');

    // 1. Generate code changes via Claude
    const codeChange = await generateCodeChange(suggestion);

    // 2. Get the current HEAD of main
    const { data: mainRef } = await octokit.git.getRef({
      owner: OWNER,
      repo: REPO,
      ref: 'heads/main',
    });
    const baseSha = mainRef.object.sha;

    // 3. Create a new branch
    const branchName = `bot-improvement-${Date.now()}`;
    await octokit.git.createRef({
      owner: OWNER,
      repo: REPO,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    // 4. Commit each changed file to the branch
    for (const change of codeChange.changes) {
      let existingSha;
      try {
        const { data: existing } = await octokit.repos.getContent({
          owner: OWNER,
          repo: REPO,
          path: change.file,
          ref: branchName,
        });
        existingSha = existing.sha;
      } catch {
        existingSha = undefined; // File doesn't exist yet (create operation)
      }

      await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path: change.file,
        message: `bot: ${codeChange.description}`,
        content: Buffer.from(change.content).toString('base64'),
        branch: branchName,
        ...(existingSha ? { sha: existingSha } : {}),
      });
    }

    // 5. Log attempt to Changelog sheet
    await addChangelogEntry(
      'improvement',
      `Proposed: ${codeChange.description} — branch: ${branchName}`,
      'awaiting-deploy-approval'
    );

    // 6. Notify owner and wait for final deploy approval
    const branchUrl = `https://github.com/${OWNER}/${REPO}/tree/${branchName}`;
    setPending(groupId, {
      type: 'deploy_approval',
      branchName,
      description: codeChange.description,
    });

    await whatsappClient.sendMessage(
      groupId,
      `✅ הכנתי את השינוי!\n\n*${codeChange.description}*\n\nענף: ${branchName}\n🔗 ${branchUrl}\n\nרוצה שאפרוס? (כן/לא)`
    );
  } catch (err) {
    console.error('[Phase2] deployImprovement error:', err.message);

    await addChangelogEntry(
      'improvement',
      `Failed: ${suggestion.proposedFeature} — ${err.message}`,
      'failed'
    ).catch(() => {}); // Don't let logging failure mask the original error

    await whatsappClient.sendMessage(
      groupId,
      `❌ לא הצלחתי ליצור את השינוי: ${err.message}`
    );
  }
}

/**
 * Step 2 (on user approval of deploy):
 * Creates a PR and merges the branch into main, triggering Render auto-deploy.
 */
async function mergeBranch(branchName, whatsappClient) {
  const groupId = process.env.WHATSAPP_GROUP_ID;

  try {
    await whatsappClient.sendMessage(groupId, '🔀 ממזג ל-main...');

    // Create PR
    const { data: pr } = await octokit.pulls.create({
      owner: OWNER,
      repo: REPO,
      title: `Bot self-improvement: ${branchName}`,
      head: branchName,
      base: 'main',
      body: `Auto-generated improvement. Approved via WhatsApp by owner.`,
    });

    // Merge it
    await octokit.pulls.merge({
      owner: OWNER,
      repo: REPO,
      pull_number: pr.number,
      merge_method: 'squash',
    });

    // Log success
    await addChangelogEntry(
      'improvement',
      `Deployed: branch ${branchName} merged to main (PR #${pr.number})`,
      'deployed'
    );

    await whatsappClient.sendMessage(
      groupId,
      `🚀 פורסם! Render יעדכן אוטומטית בעוד כמה דקות. אתם יכולים להמשיך לכתוב כרגיל.`
    );
  } catch (err) {
    console.error('[Phase2] mergeBranch error:', err.message);

    await addChangelogEntry(
      'improvement',
      `Merge failed: ${branchName} — ${err.message}`,
      'failed'
    ).catch(() => {});

    await whatsappClient.sendMessage(
      groupId,
      `❌ שגיאה בפריסה: ${err.message}\nהענף עדיין קיים ב-GitHub אם תרצו לבדוק אותו ידנית.`
    );
  }
}

module.exports = { deployImprovement, mergeBranch };
