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
    refreshInterval: 60000, // 刷新间隔（毫秒）
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

  // 更新单个基金的显示
  function updateFundDisplay(fund, data) {
    if (!data) return

    const { gsz, gszzl, gztime } = data
    const { holdingAmount, profitElement, profitRateElement } = fund

    if (!holdingAmount || !profitElement || !profitRateElement) {
      log(`基金 ${fund.code} 缺少必要元素`)
      return
    }

    // 计算实时盈亏
    const profit = calculateProfit(holdingAmount, parseFloat(gszzl))

    // 更新盈亏金额
    profitElement.innerHTML = formatProfit(profit)
    setProfitColor(profitElement, profit)

    // 更新盈亏率
    profitRateElement.innerHTML = formatProfitRate(gszzl)
    setProfitColor(profitRateElement, gszzl)

    log(`基金 ${fund.code} 更新：估值=${gsz}, 涨幅=${gszzl}%, 盈亏=${profit}`)
  }

  // 添加更新时间显示
  function addUpdateTimeLabel() {
    if (!CONFIG.showUpdateTime) return

    let timeLabel = document.getElementById('fund-valuation-update-time')
    if (!timeLabel) {
      timeLabel = document.createElement('div')
      timeLabel.id = 'fund-valuation-update-time'
      timeLabel.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.7);color:#fff;padding:8px 12px;border-radius:4px;font-size:12px;z-index:9999;'
      document.body.appendChild(timeLabel)
    }

    const now = new Date()
    timeLabel.textContent = `估值更新时间：${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
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

    // 并发请求所有基金数据
    const promises = validFunds.map(async (fund) => {
      try {
        const data = await fetchFundValuation(fund.code)
        if (data) {
          updateFundDisplay(fund, data)
        }
      } catch (error) {
        log(`基金 ${fund.code} 更新失败:`, error)
      }
    })

    await Promise.all(promises)

    addUpdateTimeLabel()
    log('基金估值更新完成')
  }

  // 页面加载完成后立即更新（带重试机制）
  async function init() {
    let retries = 0

    while (retries < CONFIG.maxRetries) {
      try {
        // 等待页面主要元素加载
        await waitForElement('.ListItemView_codeExtra', 3000)
        await waitForElement('.profitFont', 3000)

        // 额外等待确保动态内容渲染完成
        await new Promise((resolve) => setTimeout(resolve, CONFIG.retryDelay * 2))

        await updateAllFunds()
        break // 成功后退出循环
      } catch (error) {
        retries++
        log(`等待页面加载... (${retries}/${CONFIG.maxRetries})`)
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

  // 定时刷新
  if (CONFIG.refreshInterval > 0) {
    setInterval(updateAllFunds, CONFIG.refreshInterval)
    log(`已设置定时刷新：${CONFIG.refreshInterval / 1000}秒`)
  }

  log('基金实时估值脚本已启动')
})()
