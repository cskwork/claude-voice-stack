import { flashBuyAtomic } from '../../tools/flashbuy.mjs'

function resultText(result) {
  return typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result)
}

async function runAtomic(name, executor, args, context, subCalls) {
  const start = Date.now()
  let result
  try {
    result = await executor(args, context)
  } catch (err) {
    result = { result: `执行出错: ${err.message}` }
  }
  const info = {
    name,
    arguments: args,
    result: resultText(result),
    duration_ms: Date.now() - start,
  }
  subCalls.push(info)
  if (context?.onSubCall) context.onSubCall(info)
  return result
}

function emitProgress(context, event) {
  if (context?.onProgress) context.onProgress({ domain: 'flashbuy', ...event })
}

function statusAction(status, message) {
  return { type: 'flashbuy', action: 'status', status, message }
}

function resultsAction(result) {
  return {
    type: 'flashbuy',
    action: 'results',
    status: 'selecting',
    category: result.category,
    query: result.query,
    items: result.candidates || [],
    message: result.candidates?.length ? '已找到附近可送商品' : '没有找到可送商品',
  }
}

function cartAction(result) {
  return {
    type: 'flashbuy',
    action: 'cart',
    status: 'cart_updated',
    items: result.cart || [],
    category: result.cart?.[0]?.category,
    total: result.total || 0,
    message: '已更新购物车',
  }
}

function previewAction(result) {
  return {
    type: 'flashbuy',
    action: 'preview',
    status: 'awaiting_confirm',
    preview: result.preview,
    category: result.preview?.items?.[0]?.category,
    requireConfirm: true,
    message: '请确认订单后下单',
  }
}

function completedAction(result) {
  return {
    type: 'flashbuy',
    action: 'completed',
    status: 'completed',
    order: result.order,
    message: '已完成下单',
  }
}

function sessionCompletedAction(order) {
  return {
    type: 'flashbuy',
    action: 'completed',
    status: 'completed',
    order,
    message: `订单${order.id}已经提交，请勿重复下单`,
  }
}

export default {
  type: 'function',
  skill: {
    id: 'builtin.flashbuy',
    name: '闪购达人',
    description: '处理淘宝闪购外卖、奶茶搜索、加购、订单预览和确认下单',
    atomicTools: ['flashbuy_search', 'flashbuy_update_cart', 'flashbuy_preview_order', 'flashbuy_confirm_order'],
  },
  function: {
    name: 'flashbuy',
    description: '内置淘宝闪购 Skill。用于语音搜索外卖/奶茶、选择商品、加购、预览订单、确认下单或取消。用户说帮我点/来一杯/想喝/想吃时优先 add_to_cart 生成订单预览；用户只是看看/搜一下/有哪些时用 search。下单前必须先预览订单并获得用户明确确认；没有订单预览时禁止直接 confirm_order。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'add_to_cart', 'update_cart', 'preview_order', 'confirm_order', 'cancel_order'],
          description: 'search=搜索商品, add_to_cart=加入购物车, update_cart=修改购物车, preview_order=预览订单, confirm_order=确认下单, cancel_order=取消当前闪购流程',
        },
        query: {
          type: 'string',
          description: '用户想买的商品或品类，例如奶茶、外卖、茉莉轻乳茶、牛肉饭',
        },
        category: {
          type: 'string',
          enum: ['food', 'tea'],
          description: 'food=外卖热餐, tea=奶茶饮品',
        },
        itemId: {
          type: 'string',
          description: '候选商品 id，用户从候选中指定某个商品时使用',
        },
        quantity: {
          type: 'number',
          description: '商品数量',
        },
        options: {
          type: 'object',
          description: '口味、糖度、温度、规格等选项，例如 sugar=少糖, temperature=热, size=中杯',
        },
        address: {
          type: 'string',
          description: '配送位置，默认使用车辆当前位置',
        },
        confirmed: {
          type: 'boolean',
          description: '只有用户明确说确认、下单、买、支付等确认意图时才为 true',
        },
      },
      required: ['action'],
    },
  },
  execute: async (params, context) => {
    const subCalls = []
    const actions = [{ type: 'flashbuy', action: 'open' }]
    const { action } = params

    if (action === 'cancel_order') {
      emitProgress(context, { stage: 'flashbuy_cancelled', message: '已取消闪购', speakPolicy: 'always' })
      const result = await runAtomic('flashbuy_cancel_order', flashBuyAtomic.cancelOrder, {}, context, subCalls)
      actions.push({ type: 'flashbuy', action: 'cancelled', status: 'cancelled', message: result.result })
      return { result: result.result, actions, subCalls }
    }

    if (action === 'search') {
      emitProgress(context, { stage: 'flashbuy_searching', message: '正在查找附近可送商品', speakPolicy: 'always' })
      actions.push(statusAction('searching', '正在查找附近可送商品'))
      const result = await runAtomic('flashbuy_search', flashBuyAtomic.searchItems, params, context, subCalls)
      emitProgress(context, { stage: 'flashbuy_results_ready', message: '已找到可送商品', speakPolicy: 'silent' })
      actions.push(resultsAction(result))
      return {
        result: `${result.result}：${result.candidates.map(item => `${item.name}，${item.shopName}，${item.price}元，${item.eta}`).join('；')}`,
        actions,
        subCalls,
      }
    }

    if (action === 'add_to_cart') {
      if (!params.itemId) {
        emitProgress(context, { stage: 'flashbuy_searching', message: '正在查找附近可送商品', speakPolicy: 'always' })
        actions.push(statusAction('searching', '正在查找附近可送商品'))
        const search = await runAtomic('flashbuy_search', flashBuyAtomic.searchItems, params, context, subCalls)
        actions.push(resultsAction(search))
      }
      emitProgress(context, { stage: 'flashbuy_adding', message: '正在加入购物车', speakPolicy: 'if_slow' })
      actions.push(statusAction('cart_updating', '正在加入购物车'))
      const cart = await runAtomic('flashbuy_update_cart', flashBuyAtomic.addToCart, params, context, subCalls)
      actions.push(cartAction(cart))
      emitProgress(context, { stage: 'flashbuy_previewing', message: '正在试算订单', speakPolicy: 'always' })
      actions.push(statusAction('previewing', '正在试算订单'))
      const preview = await runAtomic('flashbuy_preview_order', flashBuyAtomic.previewOrder, params, context, subCalls)
      if (preview.preview) actions.push(previewAction(preview))
      return {
        result: `${cart.result}。${preview.result}。请向用户确认是否下单。`,
        actions,
        subCalls,
      }
    }

    if (action === 'update_cart') {
      emitProgress(context, { stage: 'flashbuy_cart_updating', message: '正在更新购物车', speakPolicy: 'if_slow' })
      actions.push(statusAction('cart_updating', '正在更新购物车'))
      const cart = await runAtomic('flashbuy_update_cart', flashBuyAtomic.updateCart, params, context, subCalls)
      actions.push(cartAction(cart))
      return { result: cart.result, actions, subCalls }
    }

    if (action === 'preview_order') {
      const session = flashBuyAtomic.getSession(context?.clientId)
      if (session.cart.length === 0) {
        actions.push(statusAction('selecting', '请先选择商品后再下单'))
        return { result: '购物车为空，请先选择商品', actions, subCalls }
      }

      emitProgress(context, { stage: 'flashbuy_previewing', message: '正在试算订单', speakPolicy: 'always' })
      actions.push(statusAction('previewing', '正在试算订单'))
      const preview = await runAtomic('flashbuy_preview_order', flashBuyAtomic.previewOrder, params, context, subCalls)
      if (preview.preview) actions.push(previewAction(preview))
      return { result: `${preview.result}。请向用户确认是否下单。`, actions, subCalls }
    }

    if (action === 'confirm_order') {
      const session = flashBuyAtomic.getSession(context?.clientId)
      if (session.order) {
        actions.push(sessionCompletedAction(session.order))
        return { result: `订单${session.order.id}已经提交，请勿重复下单`, actions, subCalls }
      }

      if (!session.preview) {
        if (session.cart.length > 0) {
          emitProgress(context, { stage: 'flashbuy_previewing', message: '正在试算订单', speakPolicy: 'always' })
          actions.push(statusAction('previewing', '正在试算订单'))
          const preview = await runAtomic('flashbuy_preview_order', flashBuyAtomic.previewOrder, params, context, subCalls)
          if (preview.preview) actions.push(previewAction(preview))
          return { result: `${preview.result}。请向用户确认是否下单。`, actions, subCalls }
        }

        actions.push(statusAction('selecting', '请先选择商品后再下单'))
        return { result: '还没有可确认的订单，请先选择商品并预览订单', actions, subCalls }
      }

      if (!params.confirmed) {
        actions.push(previewAction({ preview: session.preview }))
        return { result: '下单前需要用户明确确认', actions, subCalls }
      }

      emitProgress(context, { stage: 'flashbuy_ordering', message: '正在提交订单', speakPolicy: 'always' })
      actions.push(statusAction('ordering', '正在提交订单'))
      const result = await runAtomic('flashbuy_confirm_order', flashBuyAtomic.confirmOrder, params, context, subCalls)
      if (result.duplicate && result.order) {
        actions.push(sessionCompletedAction(result.order))
      } else if (result.order) {
        emitProgress(context, { stage: 'flashbuy_order_completed', message: '已完成下单', speakPolicy: 'silent' })
        actions.push(completedAction(result))
      } else if (result.preview) {
        actions.push(previewAction(result))
      }
      return { result: result.result, actions, subCalls }
    }

    return { result: '未知闪购操作', actions, subCalls }
  },
}
