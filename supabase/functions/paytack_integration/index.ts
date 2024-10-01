import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Update customer's wallet balance
async function updateCustomerWalletBalance(customerId: any, amount: number, IsCredit: boolean) {
  try {
    // Find the user by email
    const email = customerId.email;
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError) throw new Error('Failed to find user');

    // Get user's wallet
    const { data: userWallet, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', user.user_id)
      .single();

    if (walletError) throw new Error('Failed to find wallet');

    // Update user's wallet balance
    const newBalance = IsCredit ? userWallet.w_balance + amount : userWallet.w_balance - amount;
    const { error: updateError } = await supabase
      .from('wallets')
      .update({ w_balance: newBalance })
      .eq('wallet_id', userWallet.wallet_id);

    if (updateError) throw new Error('Failed to update wallet balance');
  } catch (error) {
    console.error('Error updating customer wallet balance:', error);
    throw error;
  }
}

// Create a new transaction in the transactions table for a user
async function createCustomerTransaction(customerId: any, amount: number, type: 'credit' | 'debit', status: 'success' | 'failed') {
  try {
    // Find user by email
    const email = customerId.email;
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError) throw new Error('Failed to find user');

    // Get user's wallet
    const { data: userWallet, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', user.user_id)
      .single();

    if (walletError) throw new Error('Failed to find wallet');

    // Create a new transaction
    const { error: transactionError } = await supabase
      .from('wallet_transactions')
      .insert({
        wallet_id: userWallet.wallet_id,
        t_amount: amount,
        transaction_type: type,
        status: status
      });

    if (transactionError) throw new Error('Failed to create transaction');
  } catch (error) {
    console.error('Error creating customer transaction:', error);
    throw error;
  }
}

// Update business wallet balance on Supabase
async function updateBusinessWalletBalance(recipientId: number, amount: number, IsCredit: boolean) {
  try {
    // Find business details by recipient code
    const { data: businessDetails, error: detailsError } = await supabase
      .from('biz_withdrawal_details')
      .select('*')
      .eq('recipient_code', recipientId)
      .single();

    if (detailsError) throw new Error('Failed to find business details');

    // Get business wallet
    const { data: businessWallet, error: walletError } = await supabase
      .from('business_wallets')
      .select('*')
      .eq('b_wallet_id', businessDetails.b_wallet_id)
      .single();

    if (walletError) throw new Error('Failed to find business wallet');

    // Update business wallet balance
    const newBalance = IsCredit ? businessWallet.bw_balance + amount : businessWallet.bw_balance - amount;
    const { error: updateError } = await supabase
      .from('business_wallets')
      .update({ bw_balance: newBalance })
      .eq('b_wallet_id', businessWallet.b_wallet_id);

    if (updateError) throw new Error('Failed to update business wallet balance');
  } catch (error) {
    console.error('Error updating business wallet balance:', error);
    throw error;
  }
}

// Create a new transaction for a business
async function createBusinessTransaction(recipientId: number, amount: number, type: 'credit' | 'debit', status: 'success' | 'failed') {
  try {
    // Find business details by recipient code
    const { data: businessDetails, error: detailsError } = await supabase
      .from('biz_withdrawal_details')
      .select('*')
      .eq('recipient_code', recipientId)
      .single();

    if (detailsError) throw new Error('Failed to find business details');

    // Find business wallet
    const { data: businessWallet, error: walletError } = await supabase
      .from('business_wallets')
      .select('*')
      .eq('b_wallet_id', businessDetails.b_wallet_id)
      .single();

    if (walletError) throw new Error('Failed to find business wallet');

    // Create a new transaction
    const { error: transactionError } = await supabase
      .from('business_transactions')
      .insert({
        b_wallet_id: businessWallet.b_wallet_id,
        amount,
        transaction_type: type,
        status,
      });

    if (transactionError) throw new Error('Failed to create business transaction');
  } catch (error) {
    console.error('Error creating business transaction:', error);
    throw error;
  }
}

// Handle Paystack charge success
async function handleChargeSuccess(data: any) {
  const { customer, amount } = data;
  const amountInNaira = amount / 100;

  await updateCustomerWalletBalance(customer, amountInNaira, true);
  await createCustomerTransaction(customer, amountInNaira, 'credit', 'success');
}

// Handle Paystack transfer success
async function handleTransferSuccess(data: any) {
  const { recipient, amount } = data;
  const amountInNaira = amount / 100;

  await updateBusinessWalletBalance(recipient, amountInNaira, false);
  await createBusinessTransaction(recipient, amountInNaira, 'debit', 'success');
}

// Handle Paystack transfer failure
async function handleTransferFailure(data: any) {
  const { recipient, amount } = data;
  const amountInNaira = amount / 100;

  await createBusinessTransaction(recipient, amountInNaira, 'debit', 'failed');
}

// Serve the webhook
Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const { event, data } = payload;

    switch (event) {
      case 'charge.success':
        await handleChargeSuccess(data);
        break;
      case 'transfer.success':
        await handleTransferSuccess(data);
        break;
      case 'transfer.failed':
        await handleTransferFailure(data);
        break;
      default:
        return new Response('Unsupported event type', { status: 400 });
    }

    return new Response(
      JSON.stringify({ message: 'Webhook processed successfully' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error processing webhook:', error);
    return new Response(
      JSON.stringify({ message: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
