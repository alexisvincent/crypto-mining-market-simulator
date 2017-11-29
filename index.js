const request = require('request');
const csv = require('csv');
const regression = require('regression');
const _ = require('lodash')
const fs = require('fs')
const Promise = require("bluebird");

const minedBlock = (n) => {
    return Math.random() <= n
}

const simulate = ({networkHashRate, poolHashRate, etherPrice, reward, blocksAddedToChain, days}) => {

    const timeline = _.range(1, days).map(day => ({day}))    

    const augmented = timeline.reduce((augmented, {day}) => {
        const blocksMined = _.range(blocksAddedToChain(day))
            .reduce((blocksMined, _) => blocksMined + Number(minedBlock((1.0*poolHashRate(day)) / networkHashRate(day))), 0)
        
        const augmentedDay = {}
        augmentedDay.blocksMined = blocksMined
        augmentedDay.reward = reward(day)*blocksMined
        augmentedDay.etherPrice = etherPrice(day)
        augmentedDay.rewardValue = augmentedDay.reward*augmentedDay.etherPrice

        return [...augmented, augmentedDay]
    }, [])

    const aggregated = augmented.reduce(({totalDays, totalBlocksMined, totalReward, totalRewardValue}, {day, blocksMined, reward, rewardValue}) => {
        return {
            totalDays: totalDays + 1,
            totalBlocksMined: totalBlocksMined + blocksMined,
            totalReward: totalReward + reward,
            totalRewardValue: totalRewardValue + rewardValue,

        }
    }, {totalDays: 0, totalReward: 0, totalRewardValue: 0, totalBlocksMined: 0})

    return aggregated
}

const megahash = x => 1000 * x
const gigaHash = x => 1000*megahash(x)
const gpuHash = x => x*megahash(25)

const networkHashRate = {
    default: (day) => {
        gigaHash(80473.3110)
    }
}

const poolHashRate = {
    default: () => megahash(6*25)
}

const etherPrice = {
    default: () => 305
}

const reward = {
    default: () => 5.07
}

const blocksAddedToChain = {
    default: () => {
        const avgBlockTime = 20.0
        const secondsPerDay = 60*60*24
        return secondsPerDay/avgBlockTime
    }
}

const years = (y) => y*365
const months = (m) => m*30

const etherscanNetworkHash = (cached) => {
    return new Promise((resolve, reject) => {
        if (cached) fs.readFile('./export-NetworkHash.csv', 'utf8', (err, data) => resolve(data))
        else request('https://etherscan.io/chart/hashrate?output=csv',  (error, response, body) => resolve(body))
    })
        .then(Promise.promisify(csv.parse))
        .then((data) => {
            const lookbackPeriod = months(2)

            const pastDifficulty = _.takeRight(data, lookbackPeriod)
                .map(([day, epoc, difficulty], index) => [-lookbackPeriod+index, gigaHash(difficulty)])

            const exponential = regression.exponential(pastDifficulty)
            const quadratic = regression.polynomial(pastDifficulty, { order: 2 })
            const linear = regression.linear(pastDifficulty)

            return {
                quadratic: (day) => quadratic.predict(day)[1],
                exponential: (day) => exponential.predict(day)[1],
                linear: day => linear.predict(day)[1]
            }
        })
} 
const linear = (from, to, days) => (day) => {
    return day < days ? from + (day/days)*(to-from) : 0
}

const getStats = (cached) => {
    return Promise.all([etherscanNetworkHash(cached)]).then(([networkHash]) => {
        return {
            networkHash
        }
    })
}

const pricePerHash = (gpuCost, overclocked) => {
    const hashingPotential = 12*(overclocked ? 29: 24)
    // BIOSTAR TB250-BTC PRO
    const mbcost = 100
    const ram = 60
    const powersupply = 150
    const rack = 37
    const cpu = 100
    const other = 36
    const totalcost = 12*gpuCost + mbcost + ram + cpu+ powersupply + rack + other

    return totalcost / hashingPotential
}

// console.log(pricePerHash(300, true))

getStats(true)
    .then(({networkHash: {quadratic, exponential, linear: lin}}) => {

        const profitibility = ({
            totalInvestment,
            costPerHash,
            networkHashRate,
            etherPrice,
            days,
            assetResellPercentage,
            fee
        }) => {
            const poolHashRate = megahash(totalInvestment/costPerHash)
            const agregated = simulate({
                networkHashRate: networkHashRate,
                poolHashRate: () => poolHashRate,
                etherPrice: etherPrice,
                reward: reward.default,
                blocksAddedToChain: blocksAddedToChain.default,
                days: days
            })    

            const assetValue = assetResellPercentage*totalInvestment

            console.log('pool hash rate', poolHashRate)
            console.log('total investment', totalInvestment)
            console.log('asset value', assetValue)
            console.log('total value mined', agregated.totalRewardValue)
            console.log('ROI', 100*(assetValue+agregated.totalRewardValue*(1-fee)-totalInvestment)/totalInvestment, '%')
            console.log('management fee', 13.5*agregated.totalRewardValue*fee/2)
        }

        const time = months(12)

        profitibility({
            totalInvestment: 40000,
            networkHashRate: lin,
            etherPrice: linear(300, 50, time),
            costPerHash: pricePerHash(300, true),
            days: time,
            assetResellPercentage: 0.3,
            fee: 0.15
        })

        console.log((exponential(12)-exponential(months(0)))/1000)

        // simulate({
        //     networkHashRate: exponential,
        //     poolHashRate: () => gpuHash(100),
        //     etherPrice: etherPrice.default,
        //     reward: reward.default,
        //     blocksAddedToChain: blocksAddedToChain.default,
        //     days: years(1)
        // })
})

console.log(pricePerHash(300, true))