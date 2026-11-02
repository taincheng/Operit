async function main() {
    const info = await Tools.System.getDeviceInfo();
    const page = await Tools.UI.getPageInfo();
    return { model: info.model, res: info.screenResolution, pkg: page.packageName };
}
exports.main = main;
