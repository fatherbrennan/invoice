import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

// Observe the real Explorer selection, then close only this fixture's window.
async function explorerLocation(path, directory = false) {
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `
      $ErrorActionPreference = 'Stop'
      $shell = New-Object -ComObject Shell.Application
      $deadline = [DateTime]::UtcNow.AddSeconds(15)
      do {
        foreach ($window in @($shell.Windows())) {
          try {
            if ($window.Document.Folder.Self.Path -ne $env:INVOICE_TEST_FOLDER) { continue }
            $selected = @($window.Document.SelectedItems() | ForEach-Object { $_.Path })
            if ($env:INVOICE_TEST_DIRECTORY -eq 'true' -or $selected -contains $env:INVOICE_TEST_FILE) {
              Write-Output 'verified'
              $window.Quit()
              exit 0
            }
          } catch { }
        }
        Start-Sleep -Milliseconds 100
      } while ([DateTime]::UtcNow -lt $deadline)
      throw 'Explorer did not show the expected fixture location/selection'
    `,
    ],
    {
      windowsHide: true,
      timeout: 20000,
      env: {
        ...process.env,
        INVOICE_TEST_FOLDER: directory ? path : dirname(path),
        INVOICE_TEST_FILE: path,
        INVOICE_TEST_DIRECTORY: String(directory),
      },
    },
  );
  assert.equal(stdout.trim(), 'verified');
}

export async function verifyFileLocations({
  page,
  route,
  ipc,
  fixture,
  exportFile,
  preferencesFile,
  savedPdf,
  checks,
}) {
  const button = (name) => page.getByRole('button', { name, exact: true });
  const host = page.getByRole('region', { name: 'Notifications', exact: true });
  const backup = page.locator('section[aria-labelledby="backup-status"]');
  async function missingBackup(action) {
    const recorded = await ipc('backup_status');
    const exportedAt = await backup.locator('strong').first().textContent();
    await rename(exportFile, `${exportFile}.moved`);
    try {
      await action.click();
      const error = host
        .getByRole('alert')
        .filter({ hasText: 'no longer available' });
      await error.waitFor();
      await backup.getByText('Backup unavailable', { exact: true }).waitFor();
      assert.equal(
        await backup.locator('strong').first().textContent(),
        exportedAt,
      );
      assert.deepEqual(await ipc('backup_status'), {
        ...recorded,
        available: false,
      });
      await backup.getByText(exportFile, { exact: true }).waitFor();
      await error.getByRole('button', { name: 'Dismiss notification' }).click();
    } finally {
      await rename(`${exportFile}.moved`, exportFile);
    }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await backup
      .getByText(
        'The export file is available. Changes made after this export are not backed up.',
        { exact: true },
      )
      .waitFor();
    assert.deepEqual(await ipc('backup_status'), recorded);
  }
  async function revealNotification(message, path) {
    const toast = host.getByRole('status').filter({ hasText: message });
    const action = toast.getByRole('button', {
      name: 'Show in folder',
      exact: true,
    });
    await action.focus();
    await action.press('Enter');
    await explorerLocation(path);
    await toast.getByRole('button', { name: 'Dismiss notification' }).click();
  }

  await route('Data');
  await button('Export all data').click();
  await host
    .getByRole('status')
    .filter({ hasText: 'All data exported to' })
    .waitFor();
  const original = await readFile(exportFile);
  await missingBackup(
    host
      .getByRole('status')
      .filter({ hasText: 'All data exported to' })
      .getByRole('button', { name: 'Show in folder' }),
  );
  await revealNotification('All data exported to', exportFile);
  await backup.getByRole('button', { name: 'Show in folder' }).focus();
  await backup.getByRole('button', { name: 'Show in folder' }).press('Enter');
  await explorerLocation(exportFile);
  assert.deepEqual(
    await readFile(exportFile),
    original,
    'Revealing must not alter the export',
  );

  await missingBackup(backup.getByRole('button', { name: 'Show in folder' }));
  await backup.getByRole('button', { name: 'Show in folder' }).click();
  await explorerLocation(exportFile);
  await rename(exportFile, `${exportFile}.moved`);
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await backup.getByText('Backup unavailable', { exact: true }).waitFor();
  } finally {
    await rename(`${exportFile}.moved`, exportFile);
  }
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await backup
    .getByText(
      'The export file is available. Changes made after this export are not backed up.',
      { exact: true },
    )
    .waitFor();
  await page.locator('details.recovery > summary').click();
  await button('Open folder').click();
  await explorerLocation(await ipc('data_location'), true);
  await assert.rejects(
    ipc('show_location', { path: exportFile, directory: true }),
    /not a folder/,
  );
  await assert.rejects(
    ipc('show_location', { path: 'https://example.com', directory: false }),
    /absolute file-system path/,
  );

  await route('Preferences');
  await button('Export preferences').click();
  await revealNotification('Preferences exported to', preferencesFile);
  await route('Data');
  await button('Choose export to restore').click();
  await button('Replace all data').click();
  const restored = host
    .getByRole('status')
    .filter({ hasText: 'All data restored.' });
  await restored.waitFor();
  const recovery = (await restored.locator('p').textContent()).split(
    'retained at ',
  )[1];
  await revealNotification('All data restored.', recovery);

  await ipc('save_profile', { profile: fixture.profile });
  await ipc('save_customer', { customer: fixture.customer });
  const draft = structuredClone(fixture.draft);
  for (const [index, line] of draft.lines.entries()) {
    const service = {
      id: `file-service-${index}`,
      name: line.description,
      description: line.description,
      unitPrice: line.unitPrice,
      tax: line.tax,
    };
    await ipc('save_service', { service });
    line.service = { id: service.id, name: service.name };
  }
  await ipc('save_draft', { draft });
  await ipc('issue', { id: draft.id });
  await route('Invoices');
  await button('Preview IABC1').click();
  await button('Save PDF IABC1').click();
  await revealNotification('PDF saved to', savedPdf);
  await route('Data');
  await button('Export all data').click();
  const cancelled = host
    .getByRole('status')
    .filter({ hasText: 'Export cancelled.' });
  await cancelled.waitFor();
  assert.equal(
    await cancelled.getByRole('button', { name: 'Show in folder' }).count(),
    0,
  );
  checks.push(
    'Real Windows Explorer selected backup, preferences, recovery and PDF exports; backup and notification actions work by keyboard; application folder opens; missing paths report errors and can be retried; cancellations expose no action; exports remain unchanged.',
    'Failed backup and notification reveals immediately mark Backup unavailable without clearing the saved date/path; dispatched focus and visibility events recheck real file availability and restore the available state.',
  );
}
