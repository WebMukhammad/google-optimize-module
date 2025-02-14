import weightedRandom from 'weighted-random'
import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import data from '<%= options.experimentsDir %>'

const {experiments, Google_Analitics_Trecker} = data

export default function (context, inject) {
  if(Array.isArray(experiments) && experiments.length && !skipAssignment(context) ) {
    experiments.forEach(experiment => {
      // Assign experiment and variant to user
      assignExperiment(context, experiment)
  
      // Google optimize integration
      googleOptimize(context.experiments[experiment.name])
    })
  }

  // Inject $exp
  inject('exp', context.experiments || {})
}

function assignExperiment(context, experiment) {
  // Check if current user is eligible for experiment
  if (typeof experiment.isEligible === 'function' && !experiment.isEligible(context)) return

  // Try to restore from cookie
  const cookie = getCookie(context, `exp-${experiment.name}`) || '' // id.var1-var2
  const [cookieExp, cookieVars] = cookie.split('.')

  let variantIndexes =  cookieExp && cookieVars ? cookieVars.split('-').map(variant => parseInt(variant)) : []
  

  // Validate variantIndexes against experiment (coming from cookie)
  variantIndexes = variantIndexes.filter(index => experiment.variants[index])

  // Choose enough variants
  const variantWeights = experiment?.variants?.map(variant => variant.weight === undefined ? 1 : variant.weight)

  while (variantIndexes.length < (experiment.sections || 1)) {
    const index = weightedRandom(variantWeights)
    variantWeights[index] = 0
    variantIndexes.push(index)
  }

  // Write exp cookie if changed
  const expCookie = `${experiment.id}.${variantIndexes.join('-')}`
  if (cookie !== expCookie) {
    setCookie({context, name: `exp-${experiment.name}`, value: expCookie, maxAge: experiment.maxAge})
  }
  
  context.experiments = {
    ...context.experiments,
    [experiment.name]:  {
      $variantIndexes: variantIndexes,
      $activeVariants: variantIndexes.map(index => experiment.variants[index]),
      $classes: variantIndexes.map(index => `exp-${experiment.name}-${index}`),
      ...experiment
    }
  }
}

function getCookie(context, name) {
  if (process.server && !context.req) {
    return
  }

  // Get and parse cookies
  const cookieStr = process.client ? document.cookie : context.req.headers.cookie
  const cookies = parseCookie(cookieStr || '') || {}

  return cookies[name]
}

function setCookie({context, name, value, maxAge = <%= options.maxAge %>}) {
  const serializedCookie = serializeCookie(name, value, {
    path: '/',
    maxAge
  })

  if (process.client) {
    // Set in browser
    document.cookie = serializedCookie
  } else if (process.server && context.res) {
    // Send Set-Cookie header from server side
    const prev = context.res.getHeader('Set-Cookie')
    let value = serializedCookie
    if (prev) {
      value = Array.isArray(prev) ? prev.concat(serializedCookie)
        : [prev, serializedCookie]
    }
    context.res.setHeader('Set-Cookie', value)
  }
}

// https://developers.google.com/optimize/devguides/experiments
function googleOptimize({ id, $variantIndexes }) {
  if (process.browser && id && Google_Analitics_Trecker) {
    window.addEventListener("load", () => {      
      if (window.ga) {
        const exp = `${id}.${$variantIndexes.join('-')}`
        // активируем счетчик гугл аналитики после загрузки страницы
        window.ga('create', Google_Analitics_Trecker, 'auto');
        window.ga('set', 'exp', exp)
        window.ga('send', 'pageview')
      }
    });
  }
}

// should we skip bots?
function skipAssignment(context) {
  if (!<%= options.excludeBots %>) { return }

  if (process.server) {
    return context?.req?.headers?.['user-agent']?.match(<%= options.botExpression %>)
  }

  return navigator.userAgent.match(<%= options.botExpression %>)
}