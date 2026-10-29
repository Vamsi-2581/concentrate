function helper() { return 1; }

function run(helper) {
  return helper();
}

function direct() {
  return helper();
}

module.exports = { run, direct };
