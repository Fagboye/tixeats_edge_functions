// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set')
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}


Deno.serve(async (req: Request) => {
  // Handle the actual request
  try {
    const payload = await req.json()

    const { order_id, order_status } = payload.record

    if (order_status !== 'completed') {
      return new Response(JSON.stringify({ error: 'Invalid order status' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Fetch order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_id', order_id)
      .single()

    if (orderError) throw orderError

    // Fetch business wallet
    const { data: businessWallet, error: businessWalletError } = await supabase
      .from('business_wallets')
      .select('*')
      .eq('business_id', order.business_id)
      .single()

    if (businessWalletError) throw businessWalletError

    // Fetch user wallet
    const { data: userWallet, error: userWalletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', order.user_id)
      .single()

    if (userWalletError) throw userWalletError

    // Fetch tixeats wallet
    const { data: tixeatsWallet, error: tixeatsWalletError } = await supabase
      .from('tixeats_wallet')
      .select('*')
      .single()

    if (tixeatsWalletError) throw tixeatsWalletError

    // Calculate amounts
    const businessAmount = order.total
    const charge = Math.round(order.total * 0.015) 
    const userAmount = Math.round(order.total + charge)

    // Update business wallet
    const { error: businessUpdateError } = await supabase
      .from('business_wallets')
      .update({ bw_balance: businessWallet.bw_balance + businessAmount })
      .eq('b_wallet_id', businessWallet.b_wallet_id)

    if (businessUpdateError) throw businessUpdateError

    // Update user wallet
    const { error: userUpdateError } = await supabase
      .from('wallets')
      .update({ w_balance: userWallet.w_balance - userAmount })
      .eq('wallet_id', userWallet.wallet_id)

    if (userUpdateError) throw userUpdateError


    //update tixeats wallet
    const {error: tixeatsUpdateError} = await supabase
      .from('tixeats_wallet')
      .update({ w_balance: tixeatsWallet.w_balance + charge })
      .eq('id', tixeatsWallet.id)

    if (tixeatsUpdateError) throw tixeatsUpdateError

    // Create business wallet transaction
    const { error: businessTransactionError } = await supabase
      .from('business_transactions')
      .insert({
        b_wallet_id: businessWallet.b_wallet_id,
        t_amount: businessAmount,
        transaction_type: 'credit',
        created_at: new Date().toISOString(),
        status: 'success'
      })

    if (businessTransactionError) throw businessTransactionError

    // Create user wallet transaction
    const { data: userTransaction, error: userTransactionError } = await supabase
      .from('wallet_transactions')
      .insert({
        wallet_id: userWallet.wallet_id,
        t_amount: userAmount,
        transaction_type: 'debit',
        created_at: new Date().toISOString(),
        status: 'success'
      }).select()

    if (userTransactionError) {
      console.error('Error creating user transaction:', userTransactionError)
      return new Response(JSON.stringify({ error: 'Error creating user transaction', details: userTransactionError }), 
       {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    console.log('User transaction created successfully', userTransaction)

    // Create tixeats wallet transaction
    const { error: tixeatsTransactionError } = await supabase
      .from('tixeats_transactions')
      .insert({
        wallet_id: tixeatsWallet.id,
        t_amount: charge,
        transaction_type: 'credit',
        created_at: new Date().toISOString(),
        status: 'success'
      })

    if (tixeatsTransactionError) throw tixeatsTransactionError

    console.log('Tixeats transaction created successfully')

    return new Response(JSON.stringify({ message: 'Order processed successfully' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error processing order:', error)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
