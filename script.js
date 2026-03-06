// ==UserScript==
// @name         投资账本 - 基金实时估值
// @namespace    https://github.com/yourname
// @version      1.0.0
// @description  获取基金实时估值，替换页面中的当日盈亏和盈亏率数据
// @author       Bean
// @match        https://tzzb.10jqka.com.cn/pc/index.html*
// @grant        GM_xmlhttpRequest
// @grant        GM_log
// @connect      fundgz.1234567.com.cn
// @run-at       document-end
// ==/UserScript==

;(function () {
  'use strict'

  // 配置
  const CONFIG = {
    showLog: true, // 显示日志
    showUpdateTime: true, // 显示更新时间
    retryDelay: 500, // 重试延迟（毫秒）
    maxRetries: 10, // 最大重试次数
  }

  // 日志函数
  function log(...args) {
    if (CONFIG.showLog) {
      console.log('[基金实时估值]', ...args)
    }
  }

  // 等待元素出现
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector)
      if (element) {
        resolve(element)
        return
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector)
        if (element) {
          observer.disconnect()
          resolve(element)
        }
      })

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      })

      setTimeout(() => {
        observer.disconnect()
        reject(new Error(`等待元素超时：${selector}`))
      }, timeout)
    })
  }

  // 从页面提取所有基金代码
  function extractFundCodes() {
    const fundElements = document.querySelectorAll('.ListItemView_codeExtra .ListItemView_codeNameWithHover')
    const funds = []

    log(`扫描到 ${fundElements.length} 个基金代码元素`)

    fundElements.forEach((el, index) => {
      const code = el.textContent.trim()
      if (/^\d{6}$/.test(code)) {
        // 向上查找列表项容器
        const listItem = el.closest('.PositionListTitleBox') || el.closest('.ListItemView_commonBox')
        const parentRow = listItem?.parentElement?.parentElement || el.parentElement?.parentElement?.parentElement

        // 尝试多种选择器查找持有金额
        let holdingAmountEl =
          parentRow?.querySelector('.cyje .ListItemView_titleDateContainer span') || parentRow?.querySelector('.cyje span') || el.parentElement?.parentElement?.querySelector('.cyje span')

        const holdingAmount = holdingAmountEl ? parseFloat(holdingAmountEl.textContent.trim().replace(/,/g, '')) : 0

        // 查找当日盈亏元素（多种选择器）
        let profitEl =
          parentRow?.querySelector('.dryk .profitFont span') ||
          parentRow?.querySelector('.dryk span') ||
          document.querySelectorAll('.dryk .profitFont span')[index] ||
          document.querySelectorAll('.profitFont span')[index * 2 + 1]

        // 查找当日盈亏率元素（多种选择器）
        let profitRateEl =
          parentRow?.querySelector('.drykl .profitFont span') ||
          parentRow?.querySelector('.drykl span') ||
          document.querySelectorAll('.drykl .profitFont span')[index] ||
          document.querySelectorAll('.profitFont span')[index * 2 + 2]

        // 若已有"已更新"图标，说明当日盈亏为真实数据，记录标记后仍纳入汇总
        const isUpdated = !!parentRow?.querySelector('.ListItemView_updatedIcon')
        if (isUpdated) {
          log(`基金 ${index + 1}: ${code} 已有真实数据，跳过预估更新`)
          funds.push({
            code,
            element: el,
            holdingAmount,
            profitElement: profitEl,
            profitRateElement: profitRateEl,
            parentRow,
            isUpdated: true,
          })
          return
        }

        // 调试输出
        log(`基金 ${index + 1}: ${code}`)
        log(`  - 持有金额元素：${holdingAmountEl ? '✓' : '✗'}, 值：${holdingAmount}`)
        log(`  - 盈亏元素：${profitEl ? '✓' : '✗'}`)
        log(`  - 盈亏率元素：${profitRateEl ? '✓' : '✗'}`)

        funds.push({
          code,
          element: el,
          holdingAmount,
          profitElement: profitEl,
          profitRateElement: profitRateEl,
          parentRow,
          isUpdated: false,
        })
      }
    })

    return funds
  }

  // 获取基金实时估值
  function fetchFundValuation(code) {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now()
      const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${timestamp}`

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: {
          Referer: 'https://fund.eastmoney.com/',
        },
        onload: function (response) {
          try {
            // 解析 JSONP 格式：jsonpgz({...});
            const match = response.responseText.match(/jsonpgz\((\{.*\})\);/)
            if (match && match[1]) {
              const data = JSON.parse(match[1])
              resolve(data)
            } else {
              log(`基金 ${code} 数据格式异常`)
              resolve(null)
            }
          } catch (e) {
            log(`基金 ${code} 解析失败:`, e)
            resolve(null)
          }
        },
        onerror: function (error) {
          log(`基金 ${code} 请求失败:`, error)
          reject(error)
        },
      })
    })
  }

  // 计算盈亏
  function calculateProfit(holdingAmount, growthRate) {
    // 盈亏 = 持有金额 × 涨跌幅 / 100
    return ((holdingAmount * growthRate) / 100).toFixed(2)
  }

  // 格式化盈亏显示
  function formatProfit(profit) {
    const num = parseFloat(profit)
    const prefix = num >= 0 ? '+' : ''
    return `${prefix}${num.toFixed(2)}`
  }

  // 格式化盈亏率显示
  function formatProfitRate(rate) {
    const num = parseFloat(rate)
    const prefix = num >= 0 ? '+' : ''
    return `${prefix}${num.toFixed(2)}<span class="sylUnit">%</span>`
  }

  // 在估值数字下方附加虚线下划线，表示为预估数据
  function withTilde(html) {
    return `<span style="text-decoration:underline dashed;text-underline-offset:3px;text-decoration-color:rgba(0,0,0,0.25);">${html}</span>`
  }

  // 设置元素颜色（红涨绿跌）
  function setProfitColor(element, value) {
    if (!element) return

    const num = parseFloat(value)
    if (num > 0) {
      element.style.color = '#ff2436' // 红色（涨）
    } else if (num < 0) {
      element.style.color = '#36f' // 蓝色（跌）
    } else {
      element.style.color = '#999999' // 灰色（平）
    }
  }

  // 更新单个基金的显示，返回 { profit, holdingAmount } 用于汇总
  function updateFundDisplay(fund, data) {
    if (!data) return null

    const { gsz, gszzl, gztime } = data
    const { holdingAmount, profitElement, profitRateElement } = fund

    if (!holdingAmount || !profitElement || !profitRateElement) {
      log(`基金 ${fund.code} 缺少必要元素`)
      return null
    }

    // 计算实时盈亏
    const profit = calculateProfit(holdingAmount, parseFloat(gszzl))

    // 更新盈亏金额
    profitElement.innerHTML = withTilde(formatProfit(profit))
    setProfitColor(profitElement, profit)

    // 更新盈亏率
    profitRateElement.innerHTML = withTilde(formatProfitRate(gszzl))
    setProfitColor(profitRateElement, gszzl)

    log(`基金 ${fund.code} 更新：估值=${gsz}, 涨幅=${gszzl}%, 盈亏=${profit}`)

    return { profit: parseFloat(profit), holdingAmount }
  }

  // 更新汇总行的当日盈亏和当日盈亏率
  function updateSummaryRow(totalProfit, totalHolding) {
    // 汇总行有专属的 Aggregation class，直接在其内部查找，不依赖排除逻辑
    const aggregationRow = document.querySelector('.ListItemViewWrapper.Aggregation')
    if (!aggregationRow) {
      log('未找到汇总行（.Aggregation），跳过汇总行更新')
      return
    }

    const profitEl = aggregationRow.querySelector('.dryk .ListItemView_titleDateContainer span')
    const profitRateEl = aggregationRow.querySelector('.drykl span')

    if (!profitEl && !profitRateEl) {
      log('汇总行中未找到盈亏元素，跳过汇总行更新')
      return
    }

    // 汇总盈亏率 = 总盈亏 / 总持有金额 × 100
    const totalRate = totalHolding > 0 ? (totalProfit / totalHolding) * 100 : 0

    log(`汇总行更新：总盈亏=${totalProfit.toFixed(2)}, 总持仓=${totalHolding.toFixed(2)}, 总盈亏率=${totalRate.toFixed(2)}%`)

    if (profitEl) {
      profitEl.innerHTML = withTilde(formatProfit(totalProfit))
      setProfitColor(profitEl, totalProfit)
    }

    if (profitRateEl) {
      profitRateEl.innerHTML = withTilde(formatProfitRate(totalRate))
      setProfitColor(profitRateEl, totalRate)
    }
  }

  // 添加刷新按钮和更新时间显示
  function addUpdateTimeLabel(updateTime = true) {
    if (!CONFIG.showUpdateTime) return

    const operateBox = document.querySelector('.PositionList_topOperateBox')
    const firstOperate = operateBox?.querySelector('.PositionList_singleOperateWithBorder')

    let timeLabel = document.getElementById('fund-valuation-update-time')
    if (!timeLabel) {
      timeLabel = document.createElement('div')
      timeLabel.id = 'fund-valuation-update-time'
      timeLabel.style.cssText = 'display:inline-flex;align-items:center;padding:0 12px;color:rgb(102,102,102);font-size:12px;cursor:default;'

      if (operateBox && firstOperate) {
        operateBox.insertBefore(timeLabel, firstOperate)
      } else {
        operateBox?.appendChild(timeLabel)
      }
    }

    let refreshBtn = document.getElementById('fund-valuation-refresh-btn')
    if (!refreshBtn) {
      refreshBtn = document.createElement('div')
      refreshBtn.id = 'fund-valuation-refresh-btn'
      refreshBtn.className = 'PositionList_singleOperateWithBorder'
      const refreshLabel = document.createElement('div')
      refreshLabel.className = 'PositionList_singleOperate_label'
      refreshLabel.textContent = '刷新盈亏'
      refreshBtn.appendChild(refreshLabel)
      refreshBtn.addEventListener('mouseenter', () => { refreshLabel.style.color = 'rgb(255,36,54)' })
      refreshBtn.addEventListener('mouseleave', () => { refreshLabel.style.color = '' })
      refreshBtn.addEventListener('click', () => { updateAllFunds() })

      if (timeLabel.nextSibling) {
        operateBox.insertBefore(refreshBtn, timeLabel.nextSibling)
      } else {
        operateBox?.appendChild(refreshBtn)
      }
    }

    if (updateTime) {
      const now = new Date()
      timeLabel.textContent = `估值更新：${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    }
  }

  // 主更新函数
  async function updateAllFunds() {
    log('开始更新基金估值...')

    const funds = extractFundCodes()
    if (funds.length === 0) {
      log('未找到基金数据')
      return
    }

    const validFunds = funds.filter((f) => f.profitElement && f.profitRateElement)
    log(`有效基金：${validFunds.length} / ${funds.length}`)

    if (validFunds.length === 0) {
      log('警告：所有基金都缺少必要元素，可能是页面还未完全加载')
      log('请确保页面已完全加载后再查看结果')
      return
    }

    // 并发请求所有基金数据，同时收集盈亏结果用于汇总
    let totalProfit = 0
    let totalHolding = 0

    const promises = validFunds.map(async (fund) => {
      try {
        if (fund.isUpdated) {
          // 已有真实数据：直接从 DOM 读取当前盈亏值，纳入汇总
          const profitVal = parseFloat(fund.profitElement?.textContent)
          if (!isNaN(profitVal) && fund.holdingAmount) {
            totalProfit += profitVal
            totalHolding += fund.holdingAmount
          }
          return
        }
        const data = await fetchFundValuation(fund.code)
        if (data) {
          const result = updateFundDisplay(fund, data)
          if (result) {
            totalProfit += result.profit
            totalHolding += result.holdingAmount
          }
        }
      } catch (error) {
        log(`基金 ${fund.code} 更新失败:`, error)
      }
    })

    await Promise.all(promises)

    // 更新汇总行
    updateSummaryRow(totalProfit, totalHolding)

    addUpdateTimeLabel()
    log('基金估值更新完成')
  }

  // 页面加载后插入按钮，等待操作栏出现
  async function init() {
    let retries = 0

    while (retries < CONFIG.maxRetries) {
      try {
        await waitForElement('.PositionList_topOperateBox', 3000)
        addUpdateTimeLabel(false) // 仅插入按钮，不显示时间
        break
      } catch (error) {
        retries++
        log(`等待操作栏加载... (${retries}/${CONFIG.maxRetries})`)
        await new Promise((resolve) => setTimeout(resolve, CONFIG.retryDelay))
      }
    }

    if (retries >= CONFIG.maxRetries) {
      log('错误：页面加载超时，请手动刷新页面重试')
    }
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  log('基金实时估值脚本已启动')
})()
