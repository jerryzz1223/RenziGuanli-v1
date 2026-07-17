# 内网 zip 部署与数据库分离说明

本文档适用于当前 `hrms` 应用以 zip 包方式放入内网服务器部署。核心原则是：GitHub/zip 只保存应用代码，不保存本机数据库、服务器数据库、站点密码或 `site_config.json`。

## 推荐结论

可以用 GitHub 作为个人版本管理，然后下载 zip 或用本仓库脚本生成 zip 放到内网服务器。这个方式适合你当前阶段。

不要把本地数据库一起拖到服务器。Frappe 的数据库属于站点环境，应该由服务器上的 `sites/<站点名>/site_config.json` 单独指定。你的本机站点和内网服务器站点应使用不同数据库名、数据库用户和密码。

## 代码、配置、数据库边界

| 内容 | 是否进 GitHub/zip | 说明 |
| --- | --- | --- |
| `hrms/` 应用代码 | 是 | DocType、页面、API、补丁、静态资源都在这里 |
| `docs/` 和测试脚本 | 是 | 用于版本管理和交付说明 |
| `sites/` | 否 | 这是 bench 运行时目录，包含站点配置和文件 |
| `site_config.json` | 否 | 每台服务器单独配置，包含数据库密码 |
| `common_site_config.json` | 否 | 每个 bench 单独配置，包含 Redis、socket、host 等 |
| `.sql`、`.db`、备份文件 | 否 | 数据库不得随代码提交 |
| `node_modules/`、构建缓存 | 否 | 服务器按依赖重新安装或构建 |

## 生成干净 zip

在本机仓库根目录执行：

```sh
bash scripts/make_intranet_release.sh
```

脚本会基于当前 Git 提交生成 `dist/hrms-intranet-<commit>.zip`。它只打包 Git 已提交内容，不包含 `.git`、本地数据库、`node_modules` 或未提交的临时文件。

为避免“本地改了代码，但 zip 里其实还是旧提交”的误判，脚本在工作区存在未提交改动时会直接退出。先 `git status` 确认工作区干净，再重新执行打包。

如果你明确知道自己只想导出当前 `HEAD` 提交，而忽略本地未提交修改，可以手动覆盖这个保护：

```sh
HRMS_ALLOW_DIRTY=1 bash scripts/make_intranet_release.sh
```

如果你直接从 GitHub 下载 ZIP，也可以；本质上也是下载已提交代码。区别是本脚本会给文件名带上提交号，方便追踪服务器部署的是哪一版。

## 内网服务器部署位置

假设内网服务器已有 Frappe Bench，路径为：

```sh
/home/frappe/frappe-bench
```

将 zip 解压到临时目录后，把应用目录放到：

```sh
/home/frappe/frappe-bench/apps/hrms
```

如果服务器上已经有旧版 `apps/hrms`，建议先备份旧目录，再替换代码：

```sh
cd /home/frappe/frappe-bench
cp -a apps/hrms apps/hrms.bak.$(date +%Y%m%d%H%M%S)
rm -rf apps/hrms
unzip /path/to/hrms-intranet-xxxx.zip -d /tmp/hrms-release
mv /tmp/hrms-release apps/hrms
```

如果 zip 解压后多了一层仓库目录，请把那一层目录改名或移动成 `apps/hrms`，确保存在：

```sh
/home/frappe/frappe-bench/apps/hrms/hrms/hooks.py
```

## 新站点安装

下面示例使用站点名 `hrms.local`。请按你的内网域名或 IP 替换。

```sh
cd /home/frappe/frappe-bench

bench new-site hrms.local
bench --site hrms.local install-app erpnext
bench --site hrms.local install-app hrms
bench --site hrms.local migrate
bench build --app hrms
bench restart
```

`bench new-site` 会要求输入数据库 root 密码和 Administrator 密码。服务器会在 `sites/hrms.local/site_config.json` 中生成该站点自己的数据库配置。

## 已有站点升级

如果服务器已有站点，只替换代码后执行：

```sh
cd /home/frappe/frappe-bench

bench --site <你的站点名> migrate
bench build --app hrms
bench restart
```

不要覆盖服务器的：

```sh
sites/<你的站点名>/site_config.json
sites/common_site_config.json
```

这些文件属于服务器环境，不属于应用代码。

## 本地数据库与服务器数据库分离

最优做法是环境隔离：

1. 本机继续使用本机 bench 的站点和数据库。
2. 内网服务器创建自己的 bench 站点和数据库。
3. GitHub/zip 只传应用代码。
4. 如果确实要迁移数据，用 Frappe 备份和恢复流程，而不是把数据库文件放进代码包。

数据迁移示例：

```sh
# 本机或旧服务器
bench --site <源站点> backup --with-files

# 内网服务器
bench --site <目标站点> restore /path/to/database.sql.gz --with-public-files /path/to/files.tar --with-private-files /path/to/private-files.tar
bench --site <目标站点> migrate
bench restart
```

只有在需要复制真实业务数据时才做数据迁移。新部署测试或生产初始化时，不要迁移本机开发数据库。

## 部署前检查

部署前确认：

1. 服务器 Frappe 和 ERPNext 版本与本应用匹配。
2. 本项目 `pyproject.toml` 当前要求 `frappe >=17,<18`、`erpnext >=17,<18`。
3. 服务器 MariaDB、Redis、Node、Yarn、Python 版本符合 Frappe 17 要求。
4. zip 包里没有 `sites/`、`.env`、`site_config.json`、`.sql`、`node_modules/`。
5. 部署后执行 `bench --site <站点名> migrate`，让新增 DocType、字段和补丁进入服务器数据库。
