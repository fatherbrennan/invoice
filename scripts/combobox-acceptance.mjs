export async function chooseOption(locator, label) {
  await locator.click();
  if ((await locator.getAttribute('readonly')) === null)
    await locator.fill(label);
  await locator
    .page()
    .getByRole('option', { name: label, exact: true })
    .click();
}
